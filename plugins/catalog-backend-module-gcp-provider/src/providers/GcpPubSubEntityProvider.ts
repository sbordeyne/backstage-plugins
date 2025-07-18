import { GcpEntityProviderBase } from "./GcpEntityProviderBase";
import * as pubsub from '@google-cloud/pubsub';
import {
  DeferredEntity
} from '@backstage/plugin-catalog-node';
import {
  ANNOTATION_LOCATION,
  ANNOTATION_ORIGIN_LOCATION,
} from '@backstage/catalog-model';

export class GcpPubSubEntityProvider extends GcpEntityProviderBase<pubsub.PubSub> {
  getProviderName(): string {
    return 'gcp-pubsub';
  }

  getProviderConfigKey(): string {
    return 'pubsub';
  }

  getClient(): pubsub.PubSub {
    return new pubsub.PubSub({ credentials: this.credentials });
  }

  private formatName(baseName: string): string {
    const resourceName = baseName.split('/').pop();
    if (!resourceName) {
      throw new Error(`Invalid resource name: ${baseName}`);
    }
    const name = resourceName.replace(/happn-/g, '').replace(/(prod|preprod|analytics)-/g, '').trimStart();
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
          name: this.formatName(subscription.name),
          annotations: {
            [ANNOTATION_LOCATION]: location,
            [ANNOTATION_ORIGIN_LOCATION]: location,
          },
          namespace: 'pubsub-subscriptions',
        },
        spec: {
          type: 'pubsub-subscription',
          owner: this.getOwnerReference(subscription),
          dependsOn: [
            `resource:default/${topicName}`
          ]
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
    const [ subscriptions ]= await topic.getSubscriptions();
    const subscriptionResources = subscriptions
      .map(subscription => this.subscriptionToResource(subscription, topicName))
      .filter(sub => sub !== undefined);
    const [topicPolicy] = await topic.iam.getPolicy();
    const bindings = topicPolicy.bindings || [];
    const publisherResourceRefs = bindings
      .map(binding => binding.role?.includes("publish") ? binding.members ?? [] : [])
      .flat()
      .map(
        member => `resource:service-accounts/${member.split("@")[0]}`
      );
    return [{
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
          owner: this.getOwnerReference(topic),
          dependsOn: [
            ...publisherResourceRefs
          ],
        },
      },
    },
    ...subscriptionResources
  ];
  }

  public async getResources(): Promise<DeferredEntity[]> {
    const resources = await Promise.all(
      this.config.getStringArray("projects").map(async project => {
        this.logger.info(`Discovering pubsubs in project: ${project}`);
        const [topics] = await this.client.getTopics({
          autoPaginate: true,
        });
        this.logger.info(`Found ${topics.length} topics in project: ${project}`);
        return await Promise.all(topics
          .filter(topic => topic !== undefined)
          .map(topic => this.topicToResource(topic))
          .flat() ?? []);
      }),
    );
    return resources.flat(2);
  }
}
