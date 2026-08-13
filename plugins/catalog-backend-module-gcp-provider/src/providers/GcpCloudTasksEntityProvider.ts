import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { cloudtasks_v2, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { ANNOTATION_GCP_STATUS } from '../constants';
import { apiSelfLink, lastSegment, segmentAfter } from '../utils';

/**
 * Cloud Tasks queues.
 *
 * Unlike most of the newer APIs, this one refuses a `locations/-` parent, so the locations are
 * listed first and each is asked for its queues.
 */
export class GcpCloudTasksEntityProvider extends GcpRestEntityProvider<cloudtasks_v2.Cloudtasks> {
  getProviderName(): string {
    return 'gcp-cloudtasks';
  }

  getProviderConfigKey(): string {
    return 'cloudtasks';
  }

  getClient(): cloudtasks_v2.Cloudtasks {
    return google.cloudtasks({ version: 'v2', auth: this.googleAuth });
  }

  private queueToResource(queue: cloudtasks_v2.Schema$Queue, project: string): DeferredEntity | undefined {
    const queueId = lastSegment(queue.name);
    if (!queueId) {
      return undefined;
    }
    const region = segmentAfter(queue.name, 'locations');
    const rate = queue.rateLimits?.maxDispatchesPerSecond;
    const uri = queue.httpTarget?.uriOverride;

    return this.toEntity({
      name: queueId,
      projectId: project,
      type: 'cloud-tasks-queue',
      region,
      selfLink: apiSelfLink('cloudtasks.googleapis.com', 'v2', queue.name),
      summary: `Task queue in ${region ?? 'an unreported region'}, ${
        rate ? `up to ${rate} dispatches/second` : 'at the default dispatch rate'
      }${queue.state && queue.state !== 'RUNNING' ? `, ${queue.state.toLocaleLowerCase()}` : ''}`,
      consolePath: `cloudtasks/queue/${region}/${queueId}/tasks`,
      logFilter: `resource.type="cloud_tasks_queue" resource.labels.queue_id="${queueId}"`,
      tagValues: [queue.state],
      annotations: {
        ...(queue.state ? { [ANNOTATION_GCP_STATUS]: queue.state } : {}),
        ...(uri?.host ? { 'cloud.google.com/task-target-host': uri.host } : {}),
      },
    });
  }

  /** Locations the API serves for a project, narrowed by the configured `locations`. */
  private async locationsOf(project: string): Promise<string[]> {
    const locations = await this.listAll<cloudtasks_v2.Schema$Location>(async pageToken => {
      const { data } = await this.client.projects.locations.list({ name: `projects/${project}`, pageToken });
      return { items: data.locations, nextPageToken: data.nextPageToken };
    });
    return locations
      .map(location => location.locationId ?? lastSegment(location.name))
      .filter(location => location && this.includesLocation(location));
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const locations = await this.locationsOf(project);
      const perLocation = await Promise.all(
        locations.map(location =>
          this.listAll<cloudtasks_v2.Schema$Queue>(async pageToken => {
            const { data } = await this.client.projects.locations.queues.list({
              parent: `projects/${project}/locations/${location}`,
              pageToken,
            });
            return { items: data.queues, nextPageToken: data.nextPageToken };
          }),
        ),
      );
      return perLocation
        .flat()
        .map(queue => this.queueToResource(queue, project))
        .filter(entity => entity !== undefined);
    });
  }
}
