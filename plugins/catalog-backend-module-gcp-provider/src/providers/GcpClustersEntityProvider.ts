import { GcpEntityProviderBase } from './GcpEntityProviderBase';
import * as container from '@google-cloud/container';
import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { ANNOTATION_LOCATION, ANNOTATION_ORIGIN_LOCATION } from '@backstage/catalog-model';
import {
  ANNOTATION_KUBERNETES_API_SERVER,
  ANNOTATION_KUBERNETES_API_SERVER_CA,
  ANNOTATION_KUBERNETES_AUTH_PROVIDER,
  ANNOTATION_KUBERNETES_DASHBOARD_APP,
  ANNOTATION_KUBERNETES_DASHBOARD_PARAMETERS,
} from '@backstage/plugin-kubernetes-common';
import { regionOf } from '../utils';
import { GcpStructuralRelation } from './GcpRestEntityProvider';

export class GcpClustersEntityProvider extends GcpEntityProviderBase<container.ClusterManagerClient> {
  getProviderName(): string {
    return 'gcp-clusters';
  }

  getProviderConfigKey(): string {
    return 'clusters';
  }

  getClient(): container.ClusterManagerClient {
    return new container.ClusterManagerClient({ credentials: this.credentials });
  }

  /**
   * The spec fragment for network attachment, in whichever relation vocabulary is configured.
   *
   * This provider builds its entity by hand rather than through `toEntity`, because it carries a
   * `locationKey` and the Kubernetes plugin's annotations, so it has to make the same choice
   * itself.
   */
  private networkRelations(refs: string[]): { dependsOn?: string[]; gcpRelations?: GcpStructuralRelation[] } {
    if (refs.length === 0) {
      return {};
    }
    return this.relationMode === 'builtin'
      ? { dependsOn: refs }
      : { gcpRelations: refs.map(targetRef => ({ type: 'attachedTo' as const, targetRef })) };
  }

  private async clusterToResource(
    cluster: container.protos.google.container.v1.ICluster,
    project: string,
  ): Promise<DeferredEntity | undefined> {
    const location = `${this.getProviderName()}:${cluster.location}`;

    if (!cluster.name || !cluster.selfLink || !cluster.endpoint || !cluster.location) {
      this.logger.warn(
        `ignoring partial cluster, one of name=${cluster.name}, endpoint=${cluster.endpoint}, selfLink=${cluster.selfLink} or location=${cluster.location} is missing`,
      );
      return undefined;
    }

    // TODO fix location type
    return {
      locationKey: location,
      entity: {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Resource',
        metadata: this.metadataOf({
          name: cluster.name,
          projectId: project,
          type: 'kubernetes-cluster',
          region: cluster.location,
          selfLink: cluster.selfLink,
          labels: cluster.resourceLabels,
          description: cluster.description,
          summary: `GKE cluster running ${cluster.currentMasterVersion ?? 'an unreported version'} in ${
            cluster.location
          }`,
          consolePath: `kubernetes/clusters/details/${cluster.location}/${cluster.name}`,
          logFilter: `resource.type="k8s_cluster" resource.labels.cluster_name="${cluster.name}"`,
          tagValues: [
            typeof cluster.status === 'string' ? cluster.status : undefined,
            cluster.currentMasterVersion,
            cluster.autopilot?.enabled ? 'autopilot' : 'standard',
          ],
          annotations: {
            [ANNOTATION_KUBERNETES_API_SERVER]: `https://${
              cluster.controlPlaneEndpointsConfig?.dnsEndpointConfig?.endpoint || cluster.endpoint
            }`,
            [ANNOTATION_KUBERNETES_API_SERVER_CA]: cluster.masterAuth?.clusterCaCertificate || '',
            [ANNOTATION_KUBERNETES_AUTH_PROVIDER]: 'googleServiceAccount',
            [ANNOTATION_KUBERNETES_DASHBOARD_APP]: 'gke',
            [ANNOTATION_LOCATION]: location,
            [ANNOTATION_ORIGIN_LOCATION]: location,
            [ANNOTATION_KUBERNETES_DASHBOARD_PARAMETERS]: JSON.stringify({
              projectId: project,
              region: cluster.location,
              clusterName: cluster.name,
            }),
          },
        }),
        spec: {
          type: 'kubernetes-cluster',
          owner: this.ownerOf(cluster.resourceLabels),
          ...this.systemOf(cluster.resourceLabels),
          // A cluster is plugged into its network and subnet rather than being part of them, which
          // is `attachedTo` in the GCP vocabulary and a plain dependency in the built-in one.
          ...this.networkRelations([
            ...(cluster.network ? [this.vpcRef(cluster.network, project)] : []),
            ...(cluster.subnetwork
              ? [
                  this.resourceRef('subnets', {
                    projectId: project,
                    type: 'subnetwork',
                    provider: 'gcp-subnets',
                    region: cluster.location,
                    // GKE names the network and subnet bare rather than by URL, and a subnet
                    // entity carries its region.
                    name: `${cluster.subnetwork}-${regionOf(cluster.location)}`,
                  }),
                ]
              : []),
          ]),
        },
      },
    };
  }

  public async getResources(): Promise<DeferredEntity[]> {
    const clusters = await Promise.all(
      this.config.getStringArray('projects').map(async project => {
        this.logger.info(`Discovering clusters in project: ${project}`);
        const [response] = await this.client.listClusters({
          parent: `projects/${project}/locations/-`,
        });
        const projectClusters = response.clusters ?? [];
        this.logger.info(`Found ${projectClusters.length} clusters in project: ${project}`);
        return await Promise.all(
          projectClusters
            .filter(cluster => cluster !== undefined)
            .map(cluster => this.clusterToResource(cluster, project))
            .flat() ?? [],
        );
      }),
    );
    return clusters.flat(2).filter(cluster => cluster !== undefined);
  }
}
