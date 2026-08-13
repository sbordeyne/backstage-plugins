import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { file_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { ANNOTATION_GCP_STATUS } from '../constants';
import { apiSelfLink, lastSegment, segmentAfter } from '../utils';

/** Filestore instances, related to the networks they are mounted from. */
export class GcpFilestoreEntityProvider extends GcpRestEntityProvider<file_v1.File> {
  getProviderName(): string {
    return 'gcp-filestore';
  }

  getProviderConfigKey(): string {
    return 'filestore';
  }

  getClient(): file_v1.File {
    return google.file({ version: 'v1', auth: this.googleAuth });
  }

  private instanceToResource(instance: file_v1.Schema$Instance, project: string): DeferredEntity | undefined {
    const instanceId = lastSegment(instance.name);
    if (!instanceId) {
      return undefined;
    }
    const region = segmentAfter(instance.name, 'locations');
    if (!this.includesLocation(region)) {
      return undefined;
    }
    const share = instance.fileShares?.[0];
    const networks = (instance.networks ?? [])
      .map(network => network.network)
      .filter((network): network is string => Boolean(network));

    return this.toEntity(
      {
        name: instanceId,
        projectId: project,
        type: 'filestore-instance',
        region,
        selfLink: apiSelfLink('file.googleapis.com', 'v1', instance.name),
        labels: instance.labels,
        description: instance.description,
        summary: `${(instance.tier ?? 'BASIC_HDD').toLocaleLowerCase().replace(/_/g, ' ')} Filestore instance${
          share?.capacityGb ? ` of ${share.capacityGb}GB` : ''
        } in ${region ?? 'an unreported location'}`,
        consolePath: `filestore/instances/${region}/${instanceId}`,
        tagValues: [instance.tier, instance.state],
        annotations: {
          ...(instance.state ? { [ANNOTATION_GCP_STATUS]: instance.state } : {}),
          ...(share?.name ? { 'cloud.google.com/file-share': share.name } : {}),
        },
      },
      // The network the share is reachable on, named as a bare VPC name rather than a URL.
      { dependsOn: networks.map(network => this.vpcRef(network, project)) },
    );
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const instances = await this.listAll<file_v1.Schema$Instance>(async pageToken => {
        const { data } = await this.client.projects.locations.instances.list({
          parent: `projects/${project}/locations/-`,
          pageToken,
        });
        return { items: data.instances, nextPageToken: data.nextPageToken };
      });
      return instances
        .map(instance => this.instanceToResource(instance, project))
        .filter(entity => entity !== undefined);
    });
  }
}
