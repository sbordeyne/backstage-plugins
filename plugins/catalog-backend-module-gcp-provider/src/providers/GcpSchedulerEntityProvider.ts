import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { cloudscheduler_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { ANNOTATION_GCP_STATUS } from '../constants';
import { apiSelfLink, lastSegment, segmentAfter } from '../utils';

/** What a job does when it fires, for the description and the optional tag. */
function describeTarget(
  job: cloudscheduler_v1.Schema$Job,
  topic: string | null | undefined,
): { target: string; targetKind: string } {
  if (topic) {
    return { target: `publishes to ${lastSegment(topic)}`, targetKind: 'pubsub-target' };
  }
  if (job.httpTarget?.uri) {
    return { target: `calls ${job.httpTarget.uri}`, targetKind: 'http-target' };
  }
  return { target: 'runs an App Engine handler', targetKind: 'appengine-target' };
}

/**
 * Cloud Scheduler jobs.
 *
 * A job that publishes to Pub/Sub depends on the topic it publishes to, which is what turns a
 * scheduled job in the catalog into the visible head of a pipeline.
 */
export class GcpSchedulerEntityProvider extends GcpRestEntityProvider<cloudscheduler_v1.Cloudscheduler> {
  getProviderName(): string {
    return 'gcp-scheduler';
  }

  getProviderConfigKey(): string {
    return 'scheduler';
  }

  getClient(): cloudscheduler_v1.Cloudscheduler {
    return google.cloudscheduler({ version: 'v1', auth: this.googleAuth });
  }

  private jobToResource(job: cloudscheduler_v1.Schema$Job, project: string): DeferredEntity | undefined {
    const jobId = lastSegment(job.name);
    if (!jobId) {
      return undefined;
    }
    const region = segmentAfter(job.name, 'locations');
    const topic = job.pubsubTarget?.topicName;
    const { target, targetKind } = describeTarget(job, topic);

    return this.toEntity(
      {
        name: jobId,
        projectId: project,
        type: 'scheduler-job',
        region,
        selfLink: apiSelfLink('cloudscheduler.googleapis.com', 'v1', job.name),
        description: job.description,
        summary: `On '${job.schedule ?? 'an unreported schedule'}' (${job.timeZone ?? 'UTC'}), ${target}`,
        consolePath: `cloudscheduler/jobs/edit/${region}/${jobId}`,
        logFilter: `resource.type="cloud_scheduler_job" resource.labels.job_id="${jobId}"`,
        tagValues: [job.state, targetKind],
        annotations: {
          ...(job.schedule ? { 'cloud.google.com/schedule': job.schedule } : {}),
          ...(job.state ? { [ANNOTATION_GCP_STATUS]: job.state } : {}),
        },
      },
      { dependsOn: topic ? [this.pubsubTopicRef(topic, project)] : [] },
    );
  }

  /** Locations the API serves for a project, narrowed by the configured `locations`. */
  private async locationsOf(project: string): Promise<string[]> {
    const locations = await this.listAll<cloudscheduler_v1.Schema$Location>(async pageToken => {
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
          this.listAll<cloudscheduler_v1.Schema$Job>(async pageToken => {
            const { data } = await this.client.projects.locations.jobs.list({
              parent: `projects/${project}/locations/${location}`,
              pageToken,
            });
            return { items: data.jobs, nextPageToken: data.nextPageToken };
          }),
        ),
      );
      return perLocation
        .flat()
        .map(job => this.jobToResource(job, project))
        .filter(entity => entity !== undefined);
    });
  }
}
