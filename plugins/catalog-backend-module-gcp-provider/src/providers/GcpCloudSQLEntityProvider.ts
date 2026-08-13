import { GcpEntityProviderBase } from './GcpEntityProviderBase';
import * as sql from '@google-cloud/sql';
import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { ANNOTATION_LOCATION, ANNOTATION_ORIGIN_LOCATION } from '@backstage/catalog-model';

export class GcpCloudSQLEntityProvider extends GcpEntityProviderBase<sql.SqlInstancesServiceClient> {
  getProviderName(): string {
    return 'gcp-cloudsql';
  }

  getProviderConfigKey(): string {
    return 'cloudsql';
  }

  getClient(): sql.SqlInstancesServiceClient {
    return new sql.SqlInstancesServiceClient({ credentials: this.credentials });
  }

  private sqlInstanceToResource(
    instance: sql.protos.google.cloud.sql.v1.IDatabaseInstance,
    project: string,
  ): DeferredEntity | undefined {
    if (!instance.name) {
      return undefined;
    }
    const region = instance.region ?? this.defaultRegion;
    const location = `${this.getProviderName()}:${region ?? 'unknown-region'}`;
    const labels = instance.settings?.userLabels;

    return {
      entity: {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Resource',
        metadata: this.metadataOf({
          name: instance.name,
          projectId: instance.project ?? project,
          type: 'cloudsql-instance',
          region,
          selfLink: instance.selfLink,
          labels,
          summary: `${instance.databaseVersion ?? 'Cloud SQL'} instance in ${region ?? 'an unreported region'}`,
          consolePath: `sql/instances/${instance.name}/overview`,
          logFilter: `resource.type="cloudsql_database" resource.labels.database_id="${instance.project ?? project}:${
            instance.name
          }"`,
          tagValues: [
            typeof instance.databaseVersion === 'string' ? instance.databaseVersion : undefined,
            instance.settings?.tier,
            typeof instance.state === 'string' ? instance.state : undefined,
          ],
          annotations: {
            [ANNOTATION_LOCATION]: location,
            [ANNOTATION_ORIGIN_LOCATION]: location,
          },
        }),
        spec: {
          type: 'cloudsql-instance',
          owner: this.ownerOf(labels),
          ...this.systemOf(labels),
          // A private-IP instance is only reachable from the network it is peered with.
          ...(instance.settings?.ipConfiguration?.privateNetwork
            ? { dependsOn: [this.vpcRef(instance.settings.ipConfiguration.privateNetwork, project)] }
            : {}),
        },
      },
    };
  }

  public async getResources(): Promise<DeferredEntity[]> {
    const cloudSQLInstances = await Promise.all(
      this.config.getStringArray('projects').map(async project => {
        this.logger.info(`Discovering buckets in project: ${project}`);
        const [response] = await this.client.list({
          project: project,
          maxResults: 1000,
        });
        const projectCloudSQLInstances = response.items ?? [];
        this.logger.info(`Found ${projectCloudSQLInstances.length} sql instances in project: ${project}`);
        return (
          projectCloudSQLInstances
            .filter(instance => instance !== undefined)
            .map(instance => this.sqlInstanceToResource(instance, project))
            .filter(instance => instance !== undefined) ?? []
        );
      }),
    );
    return cloudSQLInstances.flat();
  }
}
