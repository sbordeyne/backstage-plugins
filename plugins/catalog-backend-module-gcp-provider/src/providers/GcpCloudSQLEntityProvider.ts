import { ANNOTATION_GCP_PROJECT_ID } from '../constants';
import { GcpEntityProviderBase } from './GcpEntityProviderBase';
import * as sql from '@google-cloud/sql';
import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { ANNOTATION_LOCATION, ANNOTATION_ORIGIN_LOCATION } from '@backstage/catalog-model';
import { formatResourceName, regionAnnotation } from '../utils';

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
  ): DeferredEntity | undefined {
    if (!instance.name) {
      return undefined;
    }
    const region = instance.region ?? this.defaultRegion;
    const location = `${this.getProviderName()}:${region ?? 'unknown-region'}`;

    return {
      entity: {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Resource',
        metadata: {
          name: formatResourceName(instance.name),
          annotations: {
            [ANNOTATION_LOCATION]: location,
            [ANNOTATION_ORIGIN_LOCATION]: location,
            [ANNOTATION_GCP_PROJECT_ID]: instance.project ?? '',
            ...regionAnnotation(region),
          },
          namespace: 'cloudsql-instances',
        },
        spec: {
          type: 'cloudsql-instance',
          owner: this.defaultOwner,
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
            .map(instance => this.sqlInstanceToResource(instance))
            .filter(instance => instance !== undefined) ?? []
        );
      }),
    );
    return cloudSQLInstances.flat();
  }
}
