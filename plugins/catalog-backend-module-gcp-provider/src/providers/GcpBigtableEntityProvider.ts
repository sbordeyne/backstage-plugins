import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { bigtableadmin_v2, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { ANNOTATION_GCP_STATUS } from '../constants';
import { apiSelfLink, lastSegment } from '../utils';

/** Bigtable instances. */
export class GcpBigtableEntityProvider extends GcpRestEntityProvider<bigtableadmin_v2.Bigtableadmin> {
  getProviderName(): string {
    return 'gcp-bigtable';
  }

  getProviderConfigKey(): string {
    return 'bigtable';
  }

  getClient(): bigtableadmin_v2.Bigtableadmin {
    return google.bigtableadmin({ version: 'v2', auth: this.googleAuth });
  }

  private instanceToResource(instance: bigtableadmin_v2.Schema$Instance, project: string): DeferredEntity | undefined {
    const instanceId = lastSegment(instance.name);
    if (!instanceId) {
      return undefined;
    }
    const kind = (instance.type ?? 'PRODUCTION').toLocaleLowerCase();

    return this.toEntity({
      name: instanceId,
      projectId: project,
      type: 'bigtable-instance',
      selfLink: apiSelfLink('bigtableadmin.googleapis.com', 'v2', instance.name),
      labels: instance.labels,
      title: instance.displayName,
      summary: `Bigtable ${kind} instance`,
      consolePath: `bigtable/instances/${instanceId}/overview`,
      logFilter: `resource.type="bigtable_table" resource.labels.instance="${instanceId}"`,
      tagValues: [kind, instance.state],
      annotations: {
        ...(instance.state ? { [ANNOTATION_GCP_STATUS]: instance.state } : {}),
      },
    });
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      // Bigtable pages with a plain token but reports unreachable locations rather than failing.
      const instances = await this.listAll<bigtableadmin_v2.Schema$Instance>(async pageToken => {
        const { data } = await this.client.projects.instances.list({ parent: `projects/${project}`, pageToken });
        if (data.failedLocations?.length) {
          this.logger.warn(`Bigtable did not answer for ${data.failedLocations.join(', ')} in project ${project}`);
        }
        return { items: data.instances, nextPageToken: data.nextPageToken };
      });
      return instances
        .map(instance => this.instanceToResource(instance, project))
        .filter(entity => entity !== undefined);
    });
  }
}
