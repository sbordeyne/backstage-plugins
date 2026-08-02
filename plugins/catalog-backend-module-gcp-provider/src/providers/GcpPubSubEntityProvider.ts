import { GcpEntityProviderBase } from './GcpEntityProviderBase';
import * as pubsub from '@google-cloud/pubsub';
import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { ANNOTATION_LOCATION, ANNOTATION_ORIGIN_LOCATION } from '@backstage/catalog-model';
import { formatResourceName } from '../utils';

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

  private stripPrefixes(resourceName: string): string {
    const prefixes = this.config.getOptionalStringArray('stripPrefixes') ?? [];
    let name = resourceName;
    let stripped = true;
    while (stripped) {
      stripped = false;
      for (const prefix of prefixes) {
        if (prefix && name.startsWith(prefix)) {
          name = name.slice(prefix.length);
          stripped = true;
        }
      }
    }
    return name;
  }

  private formatName(baseName: string): string {
    const resourceName = baseName.split('/').pop();
    if (!resourceName) {
      throw new Error(`Invalid resource name: ${baseName}`);
    }
    const name = this.stripPrefixes(resourceName).trimStart();
    if (name.length > 63) {
      // need to truncate the name to 63 characters
      return name.substring(0, 63);
    }
    return name;
  }

  private subscriptionToResource(subscription: pubsub.Subscription, topicName: string): DeferredEntity | undefined {
    if (!subscription.name) {
      return undefined;
    }
    const location = `${this.getProviderName()}:${subscription.name}`;
    return {
      entity: {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Resource',
        metadata: {
          name: formatResourceName(this.formatName(subscription.name)),
          annotations: {
            [ANNOTATION_LOCATION]: location,
            [ANNOTATION_ORIGIN_LOCATION]: location,
          },
          namespace: 'pubsub-subscriptions',
        },
        spec: {
          type: 'pubsub-subscription',
          owner: this.defaultOwner,
          dependsOn: [`resource:default/${topicName}`],
        },
      },
    };
  }

  private async topicToResource(topic: pubsub.Topic): Promise<DeferredEntity[]> {
    if (!topic.name) {
      return [];
    }
    const location = `${this.getProviderName()}}:${topic.name}`;
    const topicName = this.formatName(topic.name);
    const [subscriptions] = await topic.getSubscriptions();
    const subscriptionResources = subscriptions
      .map(subscription => this.subscriptionToResource(subscription, topicName))
      .filter(sub => sub !== undefined);
    const [topicPolicy] = await topic.iam.getPolicy();
    const bindings = topicPolicy.bindings || [];
    const publisherResourceRefs = bindings
      .map(binding => (binding.role?.includes('publish') ? binding.members ?? [] : []))
      .flat()
      .map(member => `resource:service-accounts/${member.split('@')[0]}`);
    return [
      {
        entity: {
          apiVersion: 'backstage.io/v1alpha1',
          kind: 'Resource',
          metadata: {
            name: topicName,
            annotations: {
              [ANNOTATION_LOCATION]: location,
              [ANNOTATION_ORIGIN_LOCATION]: location,
            },
            namespace: 'pubsub-topics',
          },
          spec: {
            type: 'pubsub-topic',
            owner: this.defaultOwner,
            dependsOn: [...publisherResourceRefs],
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
            .map(topic => this.topicToResource(topic))
            .flat() ?? [],
        );
      }),
    );
    return topics.flat(2);
  }
}
