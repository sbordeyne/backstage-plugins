import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { google, memcache_v1 } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { ANNOTATION_GCP_STATUS } from '../constants';
import { apiSelfLink, lastSegment, segmentAfter } from '../utils';

/** Memorystore for Memcached instances, the same shape as the Redis provider. */
export class GcpMemcacheEntityProvider extends GcpRestEntityProvider<memcache_v1.Memcache> {
  getProviderName(): string {
    return 'gcp-memcache';
  }

  getProviderConfigKey(): string {
    return 'memcache';
  }

  getClient(): memcache_v1.Memcache {
    return google.memcache({ version: 'v1', auth: this.googleAuth });
  }

  private instanceToResource(instance: memcache_v1.Schema$Instance, project: string): DeferredEntity | undefined {
    const instanceId = lastSegment(instance.name);
    if (!instanceId) {
      return undefined;
    }
    const region = segmentAfter(instance.name, 'locations');
    if (!this.includesLocation(region)) {
      return undefined;
    }

    return this.toEntity(
      {
        name: instanceId,
        projectId: project,
        type: 'memcache-instance',
        region,
        selfLink: apiSelfLink('memcache.googleapis.com', 'v1', instance.name),
        labels: instance.labels,
        title: instance.displayName,
        summary: `Memcached ${instance.memcacheVersion ?? ''} with ${instance.nodeCount ?? 0} node(s) in ${
          region ?? 'an unreported region'
        }`.replace(/\s+/g, ' '),
        consolePath: `memorystore/memcached/locations/${region}/instances/${instanceId}/details`,
        tagValues: [instance.state, instance.memcacheVersion],
        annotations: {
          ...(instance.state ? { [ANNOTATION_GCP_STATUS]: instance.state } : {}),
        },
      },
      { attachedTo: instance.authorizedNetwork ? [this.vpcRef(instance.authorizedNetwork, project)] : [] },
    );
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const instances = await this.listAll<memcache_v1.Schema$Instance>(async pageToken => {
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
