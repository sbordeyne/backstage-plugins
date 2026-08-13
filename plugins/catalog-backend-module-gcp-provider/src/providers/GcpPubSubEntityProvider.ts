import { GcpEntityProviderBase } from './GcpEntityProviderBase';
import * as pubsub from '@google-cloud/pubsub';
import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { ANNOTATION_LOCATION, ANNOTATION_ORIGIN_LOCATION } from '@backstage/catalog-model';
import { apiSelfLink, formatResourceName, lastSegment, stripPrefixes } from '../utils';

export class GcpPubSubEntityProvider extends GcpEntityProviderBase<pubsub.PubSub> {
  getProviderName(): string {
    return 'gcp-pubsub';
  }

  getProviderConfigKey(): string {
    return 'pubsub';
  }

  getClient(): pubsub.PubSub {
    return new pubsub.PubSub();
  }

  private formatName(baseName: string): string {
    const resourceName = baseName.split('/').pop();
    if (!resourceName) {
      throw new Error(`Invalid resource name: ${baseName}`);
    }
    const prefixes = this.config.getOptionalStringArray('stripPrefixes') ?? [];
    return formatResourceName(stripPrefixes(resourceName, prefixes).trimStart());
  }

  private subscriptionToResource(
    subscription: pubsub.Subscription,
    topicRef: string,
    project: string,
  ): DeferredEntity | undefined {
    if (!subscription.name) {
      return undefined;
    }
    const location = `${this.getProviderName()}:${subscription.name}`;
    const labels = subscription.metadata?.labels;
    return {
      entity: {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Resource',
        metadata: this.metadataOf({
          name: this.formatName(subscription.name),
          projectId: project,
          type: 'pubsub-subscription',
          selfLink: apiSelfLink('pubsub.googleapis.com', 'v1', subscription.name),
          labels,
          // The name the console knows, which stripPrefixes may have taken out of the entity name.
          title: lastSegment(subscription.name),
          summary: `Pub/Sub subscription on topic ${lastSegment(topicRef)}`,
          consolePath: `cloudpubsub/subscription/detail/${lastSegment(subscription.name)}`,
          logFilter: `resource.type="pubsub_subscription" resource.labels.subscription_id="${lastSegment(
            subscription.name,
          )}"`,
          annotations: {
            [ANNOTATION_LOCATION]: location,
            [ANNOTATION_ORIGIN_LOCATION]: location,
          },
        }),
        spec: {
          type: 'pubsub-subscription',
          owner: this.ownerOf(labels),
          ...this.systemOf(labels),
          dependsOn: [topicRef],
        },
      },
    };
  }

  private async topicToResource(topic: pubsub.Topic, project: string): Promise<DeferredEntity[]> {
    if (!topic.name) {
      return [];
    }
    const location = `${this.getProviderName()}}:${topic.name}`;
    const topicName = this.formatName(topic.name);
    const labels = topic.metadata?.labels;
    const topicNamespace = this.namespaceOf({
      projectId: project,
      type: 'pubsub-topic',
      provider: this.getProviderName(),
      name: topicName,
    });
    const [subscriptions] = await topic.getSubscriptions();
    const subscriptionResources = subscriptions
      .map(subscription =>
        this.subscriptionToResource(subscription, `resource:${topicNamespace}/${topicName}`, project),
      )
      .filter(sub => sub !== undefined);
    return [
      {
        entity: {
          apiVersion: 'backstage.io/v1alpha1',
          kind: 'Resource',
          metadata: this.metadataOf({
            name: topicName,
            projectId: project,
            type: 'pubsub-topic',
            selfLink: apiSelfLink('pubsub.googleapis.com', 'v1', topic.name),
            labels,
            title: lastSegment(topic.name),
            summary: `Pub/Sub topic with ${subscriptionResources.length} subscription(s)`,
            consolePath: `cloudpubsub/topic/detail/${lastSegment(topic.name)}`,
            logFilter: `resource.type="pubsub_topic" resource.labels.topic_id="${lastSegment(topic.name)}"`,
            annotations: {
              [ANNOTATION_LOCATION]: location,
              [ANNOTATION_ORIGIN_LOCATION]: location,
            },
          }),
          spec: {
            type: 'pubsub-topic',
            owner: this.ownerOf(labels),
            ...this.systemOf(labels),
          },
        },
      },
      ...subscriptionResources,
    ];
  }

  public async getResources(): Promise<DeferredEntity[]> {
    const topics = await Promise.all(
      this.config.getStringArray('projects').map(async project => {
        this.logger.info(`Discovering pubsubs in project: ${project}`);
        const [pageTopics] = await this.client.getTopics({
          autoPaginate: true,
        });
        this.logger.info(`Found ${pageTopics.length} topics in project: ${project}`);
        return await Promise.all(
          pageTopics
            .filter(topic => topic !== undefined)
            .map(topic => this.topicToResource(topic, project))
            .flat() ?? [],
        );
      }),
    );
    return topics.flat(2);
  }
}
