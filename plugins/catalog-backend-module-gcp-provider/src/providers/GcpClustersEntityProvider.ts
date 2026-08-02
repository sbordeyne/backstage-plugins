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
import { formatResourceName } from '../utils';

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
        metadata: {
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
          name: formatResourceName(cluster.name),
          namespace: 'clusters',
        },
        spec: {
          type: 'kubernetes-cluster',
          owner: this.defaultOwner,
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
