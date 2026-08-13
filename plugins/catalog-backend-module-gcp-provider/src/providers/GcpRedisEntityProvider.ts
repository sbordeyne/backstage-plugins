import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { google, redis_v1 } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { ANNOTATION_GCP_STATUS } from '../constants';
import { apiSelfLink, lastSegment, segmentAfter } from '../utils';

/** Memorystore for Redis instances. */
export class GcpRedisEntityProvider extends GcpRestEntityProvider<redis_v1.Redis> {
  getProviderName(): string {
    return 'gcp-redis';
  }

  getProviderConfigKey(): string {
    return 'redis';
  }

  getClient(): redis_v1.Redis {
    return google.redis({ version: 'v1', auth: this.googleAuth });
  }

  private instanceToResource(instance: redis_v1.Schema$Instance, project: string): DeferredEntity | undefined {
    const instanceId = lastSegment(instance.name);
    if (!instanceId) {
      return undefined;
    }
    const region = segmentAfter(instance.name, 'locations');
    if (!this.includesLocation(region)) {
      return undefined;
    }
    const tier = (instance.tier ?? 'BASIC').toLocaleLowerCase();

    return this.toEntity(
      {
        name: instanceId,
        projectId: project,
        type: 'redis-instance',
        region,
        selfLink: apiSelfLink('redis.googleapis.com', 'v1', instance.name),
        labels: instance.labels,
        title: instance.displayName,
        summary: `${tier} tier Redis ${instance.redisVersion ?? ''} with ${instance.memorySizeGb ?? 0}GB of memory in ${
          region ?? 'an unreported region'
        }`.replace(/\s+/g, ' '),
        consolePath: `memorystore/redis/locations/${region}/instances/${instanceId}/details/overview`,
        logFilter: `resource.type="redis_instance" resource.labels.instance_id="${instanceId}"`,
        tagValues: [tier, instance.redisVersion, instance.state],
        annotations: {
          ...(instance.state ? { [ANNOTATION_GCP_STATUS]: instance.state } : {}),
        },
      },
      // The instance is only reachable from the network it is attached to.
      { dependsOn: instance.authorizedNetwork ? [this.vpcRef(instance.authorizedNetwork, project)] : [] },
    );
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      // `locations/-` asks for every region in one call; `locations` narrows it afterwards.
      const instances = await this.listAll<redis_v1.Schema$Instance>(async pageToken => {
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
