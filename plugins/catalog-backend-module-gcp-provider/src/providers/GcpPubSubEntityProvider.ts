import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { google, pubsub_v1 } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { apiSelfLink, lastSegment, pubsubSubscriptionName, stripPrefixes } from '../utils';

/** The topic a subscription whose topic has been deleted reports. */
const DELETED_TOPIC = '_deleted-topic_';

/** Pub/Sub topics and the subscriptions on them. */
export class GcpPubSubEntityProvider extends GcpRestEntityProvider<pubsub_v1.Pubsub> {
  getProviderName(): string {
    return 'gcp-pubsub';
  }

  getProviderConfigKey(): string {
    return 'pubsub';
  }

  getClient(): pubsub_v1.Pubsub {
    return google.pubsub({ version: 'v1', auth: this.googleAuth });
  }

  /** The leaf of a topic or subscription path, with the configured prefixes taken off. */
  private strippedName(resourceName: string): string {
    const prefixes = this.config.getOptionalStringArray('stripPrefixes') ?? [];
    return stripPrefixes(lastSegment(resourceName), prefixes);
  }

  private subscriptionToResource(
    subscription: pubsub_v1.Schema$Subscription,
    topicRef: string | undefined,
    project: string,
  ): DeferredEntity | undefined {
    if (!subscription.name) {
      return undefined;
    }
    const subscriptionId = lastSegment(subscription.name);

    return this.toEntity(
      {
        name: pubsubSubscriptionName(this.strippedName(subscription.name)),
        projectId: project,
        type: 'pubsub-subscription',
        selfLink: apiSelfLink('pubsub.googleapis.com', 'v1', subscription.name),
        labels: subscription.labels,
        // The name the console knows, which stripPrefixes may have taken out of the entity name.
        title: subscriptionId,
        summary: topicRef
          ? `Pub/Sub subscription on topic ${lastSegment(topicRef)}`
          : 'Pub/Sub subscription whose topic has been deleted',
        consolePath: `cloudpubsub/subscription/detail/${subscriptionId}`,
        logFilter: `resource.type="pubsub_subscription" resource.labels.subscription_id="${subscriptionId}"`,
        assetName: `//pubsub.googleapis.com/projects/${project}/subscriptions/${subscriptionId}`,
      },
      { dependsOn: topicRef ? [topicRef] : [] },
    );
  }

  private topicToResource(
    topic: pubsub_v1.Schema$Topic,
    subscriptions: number,
    project: string,
  ): DeferredEntity | undefined {
    const topicId = lastSegment(topic.name);

    return this.toEntity({
      name: this.strippedName(topic.name ?? ''),
      projectId: project,
      type: 'pubsub-topic',
      selfLink: apiSelfLink('pubsub.googleapis.com', 'v1', topic.name),
      labels: topic.labels,
      title: topicId,
      summary: `Pub/Sub topic with ${subscriptions} subscription(s)`,
      consolePath: `cloudpubsub/topic/detail/${topicId}`,
      logFilter: `resource.type="pubsub_topic" resource.labels.topic_id="${topicId}"`,
      assetName: `//pubsub.googleapis.com/projects/${project}/topics/${topicId}`,
    });
  }

  /** Ref of the entity a topic path is ingested as, under this provider's own naming. */
  private topicRef(topicName: string, project: string): string | undefined {
    return this.ownRef({
      projectId: project,
      type: 'pubsub-topic',
      provider: this.getProviderName(),
      name: this.strippedName(topicName),
    });
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      // Subscriptions are listed once for the whole project rather than once per topic: the
      // per-topic call answers with names alone, so it would cost a `get` per subscription to
      // recover the labels an entity is built from.
      const [topics, subscriptions] = await Promise.all([
        this.listAll<pubsub_v1.Schema$Topic>(async pageToken => {
          const { data } = await this.client.projects.topics.list({ project: `projects/${project}`, pageToken });
          return { items: data.topics, nextPageToken: data.nextPageToken };
        }),
        this.listAll<pubsub_v1.Schema$Subscription>(async pageToken => {
          const { data } = await this.client.projects.subscriptions.list({
            project: `projects/${project}`,
            pageToken,
          });
          return { items: data.subscriptions, nextPageToken: data.nextPageToken };
        }),
      ]);

      const byTopic = new Map<string, pubsub_v1.Schema$Subscription[]>();
      for (const subscription of subscriptions) {
        const topic = subscription.topic ?? DELETED_TOPIC;
        byTopic.set(topic, [...(byTopic.get(topic) ?? []), subscription]);
      }

      const entities: DeferredEntity[] = [];
      for (const topic of topics) {
        if (!topic.name) {
          continue;
        }
        const onTopic = byTopic.get(topic.name) ?? [];
        const topicEntity = this.topicToResource(topic, onTopic.length, project);
        if (!topicEntity) {
          continue;
        }
        entities.push(topicEntity);
        for (const subscription of onTopic) {
          const entity = this.subscriptionToResource(subscription, this.topicRef(topic.name, project), project);
          if (entity) {
            entities.push(entity);
          }
        }
      }

      // A subscription whose topic is gone is still a real resource, and is still worth cataloguing.
      for (const subscription of byTopic.get(DELETED_TOPIC) ?? []) {
        const entity = this.subscriptionToResource(subscription, undefined, project);
        if (entity) {
          entities.push(entity);
        }
      }

      return entities;
    });
  }
}
