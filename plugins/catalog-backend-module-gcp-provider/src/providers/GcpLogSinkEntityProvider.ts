import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { google, logging_v2 } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { apiSelfLink, lastSegment, segmentAfter } from '../utils';

/**
 * Log sinks.
 *
 * A sink is a data flow: logs leaving the project for a bucket, a dataset or a topic. Relating it
 * to its destination is what makes "where does this data end up" answerable from the catalog.
 */
export class GcpLogSinkEntityProvider extends GcpRestEntityProvider<logging_v2.Logging> {
  getProviderName(): string {
    return 'gcp-logsinks';
  }

  getProviderConfigKey(): string {
    return 'logsinks';
  }

  getClient(): logging_v2.Logging {
    return google.logging({ version: 'v2', auth: this.googleAuth });
  }

  /**
   * The entity a sink destination points at.
   *
   * Destinations are written as `storage.googleapis.com/my-bucket`,
   * `bigquery.googleapis.com/projects/p/datasets/d` or `pubsub.googleapis.com/projects/p/topics/t`,
   * so the service prefix decides which provider owns the target.
   */
  private destinationRef(destination: string, project: string): string | undefined {
    const [service] = destination.split('/');
    const targetProject = segmentAfter(destination, 'projects') ?? project;
    const leaf = lastSegment(destination);

    if (service.startsWith('storage')) {
      return this.resourceRef('storage', {
        projectId: targetProject,
        type: 'bucket',
        provider: 'gcp-bucket',
        name: leaf,
      });
    }
    if (service.startsWith('bigquery')) {
      return this.resourceRef('bigquery', {
        projectId: targetProject,
        type: 'bigquery-dataset',
        provider: 'gcp-bigquery',
        name: leaf,
      });
    }
    if (service.startsWith('pubsub')) {
      return this.pubsubTopicRef(destination, targetProject);
    }
    return undefined;
  }

  private sinkToResource(sink: logging_v2.Schema$LogSink, project: string): DeferredEntity | undefined {
    if (!sink.name) {
      return undefined;
    }
    const destination = sink.destination ?? '';
    const ref = destination ? this.destinationRef(destination, project) : undefined;

    return this.toEntity(
      {
        name: sink.name,
        projectId: project,
        type: 'log-sink',
        selfLink: apiSelfLink('logging.googleapis.com', 'v2', `projects/${project}/sinks/${sink.name}`),
        description: sink.description,
        summary: `${sink.disabled ? 'Disabled sink' : 'Sink'} exporting to ${
          destination || 'an unreported destination'
        }`,
        consolePath: `logs/router/sink/edit/${sink.name}`,
        tagValues: [sink.disabled ? 'disabled' : 'enabled', destination.split('/')[0]],
        annotations: {
          ...(destination ? { 'cloud.google.com/sink-destination': destination } : {}),
          ...(sink.filter ? { 'cloud.google.com/sink-filter': sink.filter } : {}),
        },
      },
      { dependsOn: ref ? [ref] : [] },
    );
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const sinks = await this.listAll<logging_v2.Schema$LogSink>(async pageToken => {
        const { data } = await this.client.projects.sinks.list({ parent: `projects/${project}`, pageToken });
        return { items: data.sinks, nextPageToken: data.nextPageToken };
      });
      return sinks.map(sink => this.sinkToResource(sink, project)).filter(entity => entity !== undefined);
    });
  }
}
