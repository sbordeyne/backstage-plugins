import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { dataproc_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { ANNOTATION_GCP_STATUS } from '../constants';

/**
 * Dataproc clusters.
 *
 * The API is regional with no wildcard, so the regions come from `locations`, defaulting to the
 * handful a cluster is usually in rather than to every region GCP has.
 */
export class GcpDataprocEntityProvider extends GcpRestEntityProvider<dataproc_v1.Dataproc> {
  getProviderName(): string {
    return 'gcp-dataproc';
  }

  getProviderConfigKey(): string {
    return 'dataproc';
  }

  getClient(): dataproc_v1.Dataproc {
    return google.dataproc({ version: 'v1', auth: this.googleAuth });
  }

  private clusterToResource(
    cluster: dataproc_v1.Schema$Cluster,
    region: string,
    project: string,
  ): DeferredEntity | undefined {
    if (!cluster.clusterName) {
      return undefined;
    }
    const gce = cluster.config?.gceClusterConfig;
    const workers = cluster.config?.workerConfig?.numInstances ?? 0;

    return this.toEntity(
      {
        name: cluster.clusterName,
        projectId: project,
        type: 'dataproc-cluster',
        region,
        selfLink: `https://dataproc.googleapis.com/v1/projects/${project}/regions/${region}/clusters/${cluster.clusterName}`,
        labels: cluster.labels,
        summary: `Dataproc cluster with ${workers} worker(s) in ${region}, ${(
          cluster.status?.state ?? 'unknown state'
        ).toLocaleLowerCase()}`,
        consolePath: `dataproc/clusters/${cluster.clusterName}/monitoring?region=${region}`,
        logFilter: `resource.type="cloud_dataproc_cluster" resource.labels.cluster_name="${cluster.clusterName}"`,
        tagValues: [cluster.status?.state, cluster.config?.softwareConfig?.imageVersion],
        annotations: {
          ...(cluster.status?.state ? { [ANNOTATION_GCP_STATUS]: cluster.status.state } : {}),
        },
      },
      {
        dependsOn: [
          ...(gce?.networkUri ? [this.vpcRef(gce.networkUri, project)] : []),
          ...(gce?.subnetworkUri ? [this.subnetRef(gce.subnetworkUri, project)] : []),
          ...(gce?.serviceAccount ? [this.serviceAccountRef(gce.serviceAccount)] : []),
          ...(cluster.config?.configBucket
            ? [
                this.resourceRef('storage', {
                  projectId: project,
                  type: 'bucket',
                  provider: 'gcp-bucket',
                  name: cluster.config.configBucket,
                }),
              ]
            : []),
        ],
      },
    );
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      // Without `locations` there is nothing sensible to iterate: the API takes one region per call
      // and has no aggregated form.
      const regions = this.locations ?? ['global'];
      const perRegion = await Promise.all(
        regions.map(region =>
          this.listAll<dataproc_v1.Schema$Cluster>(async pageToken => {
            const { data } = await this.client.projects.regions.clusters.list({
              projectId: project,
              region,
              pageToken,
            });
            return { items: data.clusters, nextPageToken: data.nextPageToken };
          }).then(clusters => ({ region, clusters })),
        ),
      );

      return perRegion
        .flatMap(({ region, clusters }) => clusters.map(cluster => this.clusterToResource(cluster, region, project)))
        .filter(entity => entity !== undefined);
    });
  }
}
