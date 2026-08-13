import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { eventarc_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { apiSelfLink, lastSegment, segmentAfter } from '../utils';

/**
 * Eventarc triggers.
 *
 * These are the wiring of the estate: a trigger names the Pub/Sub topic events arrive on and the
 * Cloud Run service, function or workflow they are delivered to, so the entity carries a relation
 * to both and joins two otherwise unconnected halves of the catalog.
 */
export class GcpEventarcEntityProvider extends GcpRestEntityProvider<eventarc_v1.Eventarc> {
  getProviderName(): string {
    return 'gcp-eventarc';
  }

  getProviderConfigKey(): string {
    return 'eventarc';
  }

  getClient(): eventarc_v1.Eventarc {
    return google.eventarc({ version: 'v1', auth: this.googleAuth });
  }

  /** What the trigger delivers to, as a ref and as a phrase for the description. */
  private destinationOf(
    destination: eventarc_v1.Schema$Destination | undefined,
    region: string | undefined,
    project: string,
  ): { ref?: string; described: string } {
    if (destination?.cloudRun?.service) {
      const service = destination.cloudRun.service;
      return {
        ref: this.cloudRunServiceRef(service, destination.cloudRun.region ?? region, project),
        described: `Cloud Run service ${service}`,
      };
    }
    if (destination?.cloudFunction) {
      return { described: `Cloud Function ${lastSegment(destination.cloudFunction)}` };
    }
    if (destination?.workflow) {
      return { described: `workflow ${lastSegment(destination.workflow)}` };
    }
    if (destination?.gke?.service) {
      return { described: `GKE service ${destination.gke.service}` };
    }
    if (destination?.httpEndpoint?.uri) {
      return { described: `HTTP endpoint ${destination.httpEndpoint.uri}` };
    }
    return { described: 'an unreported destination' };
  }

  private triggerToResource(trigger: eventarc_v1.Schema$Trigger, project: string): DeferredEntity | undefined {
    const triggerId = lastSegment(trigger.name);
    if (!triggerId) {
      return undefined;
    }
    const region = segmentAfter(trigger.name, 'locations');
    if (!this.includesLocation(region)) {
      return undefined;
    }
    const eventType = trigger.eventFilters?.find(filter => filter.attribute === 'type')?.value;
    const destination = this.destinationOf(trigger.destination, region, project);
    const topic = trigger.transport?.pubsub?.topic;

    return this.toEntity(
      {
        name: triggerId,
        projectId: project,
        type: 'eventarc-trigger',
        region,
        selfLink: apiSelfLink('eventarc.googleapis.com', 'v1', trigger.name),
        labels: trigger.labels,
        summary: `Delivers ${eventType ?? 'events'} to ${destination.described}`,
        consolePath: `eventarc/triggers/${region}/${triggerId}`,
        tagValues: [eventType],
        annotations: {
          ...(eventType ? { 'cloud.google.com/event-type': eventType } : {}),
        },
      },
      {
        dependsOn: [
          ...(topic ? [this.pubsubTopicRef(topic, project)] : []),
          ...(trigger.serviceAccount ? [this.serviceAccountRef(trigger.serviceAccount)] : []),
        ],
        // The trigger feeds its destination, rather than the other way round.
        dependencyOf: destination.ref ? [destination.ref] : [],
      },
    );
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const triggers = await this.listAll<eventarc_v1.Schema$Trigger>(async pageToken => {
        const { data } = await this.client.projects.locations.triggers.list({
          parent: `projects/${project}/locations/-`,
          pageToken,
        });
        return { items: data.triggers, nextPageToken: data.nextPageToken };
      });
      return triggers.map(trigger => this.triggerToResource(trigger, project)).filter(entity => entity !== undefined);
    });
  }
}
