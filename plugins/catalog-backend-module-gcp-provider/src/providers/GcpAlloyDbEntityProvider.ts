import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { alloydb_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { ANNOTATION_GCP_STATUS } from '../constants';
import { apiSelfLink, lastSegment, segmentAfter } from '../utils';

/**
 * AlloyDB clusters and their instances.
 *
 * As with Spanner, the instances hang off the cluster's resource name, so one provider covers both
 * rather than listing the clusters twice.
 */
export class GcpAlloyDbEntityProvider extends GcpRestEntityProvider<alloydb_v1.Alloydb> {
  getProviderName(): string {
    return 'gcp-alloydb';
  }

  getProviderConfigKey(): string {
    return 'alloydb';
  }

  getClient(): alloydb_v1.Alloydb {
    return google.alloydb({ version: 'v1', auth: this.googleAuth });
  }

  private instanceToResource(
    instance: alloydb_v1.Schema$Instance,
    clusterId: string,
    region: string | undefined,
    project: string,
    clusterRef: string,
  ): DeferredEntity | undefined {
    const instanceId = lastSegment(instance.name);
    if (!instanceId) {
      return undefined;
    }
    const kind = (instance.instanceType ?? 'PRIMARY').toLocaleLowerCase();

    return this.toEntity(
      {
        // Instance ids are unique per cluster.
        name: `${clusterId}-${instanceId}`,
        projectId: project,
        type: 'alloydb-instance',
        region,
        selfLink: apiSelfLink('alloydb.googleapis.com', 'v1', instance.name),
        labels: instance.labels,
        title: instanceId,
        summary: `AlloyDB ${kind} instance with ${instance.machineConfig?.cpuCount ?? 0} vCPU on cluster ${clusterId}`,
        consolePath: `alloydb/clusters/${region}/${clusterId}/instances/${instanceId}`,
        logFilter: `resource.type="alloydb.googleapis.com/Instance" resource.labels.instance_id="${instanceId}"`,
        tagValues: [kind, instance.state],
        annotations: {
          ...(instance.state ? { [ANNOTATION_GCP_STATUS]: instance.state } : {}),
        },
      },
      { partOf: [clusterRef] },
    );
  }

  private async clusterToResources(cluster: alloydb_v1.Schema$Cluster, project: string): Promise<DeferredEntity[]> {
    const clusterId = lastSegment(cluster.name);
    if (!clusterId) {
      return [];
    }
    const region = segmentAfter(cluster.name, 'locations');
    if (!this.includesLocation(region)) {
      return [];
    }
    const network = cluster.networkConfig?.network ?? cluster.network;

    const clusterRef = this.ownRef({
      projectId: project,
      type: 'alloydb-cluster',
      provider: this.getProviderName(),
      region,
      name: clusterId,
    });

    const clusterEntity = this.toEntity(
      {
        name: clusterId,
        projectId: project,
        type: 'alloydb-cluster',
        region,
        selfLink: apiSelfLink('alloydb.googleapis.com', 'v1', cluster.name),
        labels: cluster.labels,
        title: cluster.displayName,
        summary: `AlloyDB cluster running ${cluster.databaseVersion ?? 'PostgreSQL'} in ${
          region ?? 'an unreported region'
        }`,
        consolePath: `alloydb/clusters/${region}/${clusterId}`,
        tagValues: [cluster.databaseVersion, cluster.state, cluster.clusterType],
        annotations: {
          ...(cluster.state ? { [ANNOTATION_GCP_STATUS]: cluster.state } : {}),
        },
      },
      { dependsOn: network ? [this.vpcRef(network, project)] : [] },
    );

    const instances = await this.listAll<alloydb_v1.Schema$Instance>(async pageToken => {
      const { data } = await this.client.projects.locations.clusters.instances.list({
        parent: cluster.name!,
        pageToken,
      });
      return { items: data.instances, nextPageToken: data.nextPageToken };
    });

    return [
      clusterEntity,
      ...instances
        .map(instance => this.instanceToResource(instance, clusterId, region, project, clusterRef))
        .filter(entity => entity !== undefined),
    ];
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const clusters = await this.listAll<alloydb_v1.Schema$Cluster>(async pageToken => {
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
