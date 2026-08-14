import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { ANNOTATION_LOCATION, ANNOTATION_ORIGIN_LOCATION } from '@backstage/catalog-model';
import { container_v1, google } from 'googleapis';
import {
  ANNOTATION_KUBERNETES_API_SERVER,
  ANNOTATION_KUBERNETES_API_SERVER_CA,
  ANNOTATION_KUBERNETES_AUTH_PROVIDER,
  ANNOTATION_KUBERNETES_DASHBOARD_APP,
  ANNOTATION_KUBERNETES_DASHBOARD_PARAMETERS,
} from '@backstage/plugin-kubernetes-common';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { regionOf } from '../utils';

/** GKE clusters, annotated so the Kubernetes plugin can reach them. */
export class GcpClustersEntityProvider extends GcpRestEntityProvider<container_v1.Container> {
  getProviderName(): string {
    return 'gcp-clusters';
  }

  getProviderConfigKey(): string {
    return 'clusters';
  }

  getClient(): container_v1.Container {
    return google.container({ version: 'v1', auth: this.googleAuth });
  }

  private clusterToResource(cluster: container_v1.Schema$Cluster, project: string): DeferredEntity | undefined {
    if (!cluster.name || !cluster.selfLink || !cluster.endpoint || !cluster.location) {
      this.logger.warn(
        `ignoring partial cluster, one of name=${cluster.name}, endpoint=${cluster.endpoint}, ` +
          `selfLink=${cluster.selfLink} or location=${cluster.location} is missing`,
      );
      return undefined;
    }
    if (!this.includesLocation(cluster.location)) {
      return undefined;
    }
    const location = `${this.getProviderName()}:${cluster.location}`;

    const entity = this.toEntity(
      {
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
          cluster.status,
          cluster.currentMasterVersion,
          cluster.autopilot?.enabled ? 'autopilot' : 'standard',
        ],
        assetName: `//container.googleapis.com/projects/${project}/locations/${cluster.location}/clusters/${cluster.name}`,
        annotations: {
          [ANNOTATION_KUBERNETES_API_SERVER]: `https://${
            cluster.controlPlaneEndpointsConfig?.dnsEndpointConfig?.endpoint || cluster.endpoint
          }`,
          [ANNOTATION_KUBERNETES_API_SERVER_CA]: cluster.masterAuth?.clusterCaCertificate || '',
          [ANNOTATION_KUBERNETES_AUTH_PROVIDER]: 'googleServiceAccount',
          [ANNOTATION_KUBERNETES_DASHBOARD_APP]: 'gke',
          // The cluster is keyed by location rather than by its own URL, so both halves of the
          // location annotation have to be set explicitly.
          [ANNOTATION_LOCATION]: location,
          [ANNOTATION_ORIGIN_LOCATION]: location,
          [ANNOTATION_KUBERNETES_DASHBOARD_PARAMETERS]: JSON.stringify({
            projectId: project,
            region: cluster.location,
            clusterName: cluster.name,
          }),
        },
      },
      {
        // A cluster is plugged into its network and subnet rather than being part of them.
        attachedTo: [
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
        ],
      },
    );

    // A cluster is addressed by its location, so entities from two locations never collide.
    return entity && { ...entity, locationKey: location };
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      // `locations/-` asks for every zone and region in one call; the listing is not paginated.
      const { data } = await this.client.projects.locations.clusters.list({
        parent: `projects/${project}/locations/-`,
      });
      return (data.clusters ?? [])
        .map(cluster => this.clusterToResource(cluster, project))
        .filter(entity => entity !== undefined);
    });
  }
}
