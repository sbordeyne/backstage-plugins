import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { google, managedkafka_v1 } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { ANNOTATION_GCP_STATUS } from '../constants';
import { apiSelfLink, lastSegment, segmentAfter } from '../utils';

/** Managed Service for Apache Kafka clusters and the topics on them. */
export class GcpKafkaEntityProvider extends GcpRestEntityProvider<managedkafka_v1.Managedkafka> {
  getProviderName(): string {
    return 'gcp-managedkafka';
  }

  getProviderConfigKey(): string {
    return 'managedkafka';
  }

  getClient(): managedkafka_v1.Managedkafka {
    return google.managedkafka({ version: 'v1', auth: this.googleAuth });
  }

  private topicToResource(
    topic: managedkafka_v1.Schema$Topic,
    clusterId: string,
    region: string | undefined,
    project: string,
    clusterRef: string | undefined,
  ): DeferredEntity | undefined {
    const topicId = lastSegment(topic.name);
    if (!topicId) {
      return undefined;
    }

    return this.toEntity(
      {
        // Topic names are unique per cluster.
        name: `${clusterId}-${topicId}`,
        projectId: project,
        type: 'kafka-topic',
        region,
        selfLink: apiSelfLink('managedkafka.googleapis.com', 'v1', topic.name),
        title: topicId,
        summary: `Kafka topic with ${topic.partitionCount ?? 0} partition(s) and a replication factor of ${
          topic.replicationFactor ?? 0
        } on cluster ${clusterId}`,
        consolePath: `managedkafka/${region}/clusters/${clusterId}/topics/${topicId}`,
        tagValues: [topic.configs?.['cleanup.policy'], topic.configs?.['compression.type']],
      },
      { partOf: [clusterRef] },
    );
  }

  private async clusterToResources(
    cluster: managedkafka_v1.Schema$Cluster,
    project: string,
  ): Promise<DeferredEntity[]> {
    const clusterId = lastSegment(cluster.name);
    if (!clusterId) {
      return [];
    }
    const region = segmentAfter(cluster.name, 'locations');
    if (!this.includesLocation(region)) {
      return [];
    }
    // Brokers are reached through Private Service Connect endpoints in the given subnets, so the
    // dependency is on the subnet rather than on the network as a whole.
    const subnets = (cluster.gcpConfig?.accessConfig?.networkConfigs ?? [])
      .map(networkConfig => networkConfig.subnet)
      .filter((subnet): subnet is string => Boolean(subnet));

    const clusterRef = this.ownRef({
      projectId: project,
      type: 'kafka-cluster',
      provider: this.getProviderName(),
      region,
      name: clusterId,
    });

    const clusterEntity = this.toEntity(
      {
        name: clusterId,
        projectId: project,
        type: 'kafka-cluster',
        region,
        selfLink: apiSelfLink('managedkafka.googleapis.com', 'v1', cluster.name),
        labels: cluster.labels,
        summary: `Managed Kafka cluster with ${cluster.capacityConfig?.vcpuCount ?? 0} vCPU in ${
          region ?? 'an unreported region'
        }`,
        consolePath: `managedkafka/${region}/clusters/${clusterId}`,
        logFilter: `resource.type="managedkafka.googleapis.com/Cluster" resource.labels.cluster_id="${clusterId}"`,
        tagValues: [cluster.state],
        annotations: {
          ...(cluster.state ? { [ANNOTATION_GCP_STATUS]: cluster.state } : {}),
        },
      },
      { dependsOn: subnets.map(subnet => this.subnetRef(subnet, project)) },
    );

    const topics = await this.listAll<managedkafka_v1.Schema$Topic>(async pageToken => {
      const { data } = await this.client.projects.locations.clusters.topics.list({ parent: cluster.name!, pageToken });
      return { items: data.topics, nextPageToken: data.nextPageToken };
    });

    if (!clusterEntity) {
      return [];
    }
    return [
      clusterEntity,
      ...topics
        .map(topic => this.topicToResource(topic, clusterId, region, project, clusterRef))
        .filter(entity => entity !== undefined),
    ];
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const clusters = await this.listAll<managedkafka_v1.Schema$Cluster>(async pageToken => {
        const { data } = await this.client.projects.locations.clusters.list({
          parent: `projects/${project}/locations/-`,
          pageToken,
        });
        return { items: data.clusters, nextPageToken: data.nextPageToken };
      });
      const entities = await Promise.all(
        clusters.filter(cluster => cluster.name).map(cluster => this.clusterToResources(cluster, project)),
      );
      return entities.flat();
    });
  }
}
