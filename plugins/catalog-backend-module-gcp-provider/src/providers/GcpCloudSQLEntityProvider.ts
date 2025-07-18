import { ANNOTATION_GCP_PROJECT_ID, ANNOTATION_GCP_REGION } from "../constants";
import { GcpEntityProviderBase } from "./GcpEntityProviderBase";
import * as sql from '@google-cloud/sql';
import {
  DeferredEntity
} from '@backstage/plugin-catalog-node';
import {
  ANNOTATION_LOCATION,
  ANNOTATION_ORIGIN_LOCATION,
} from '@backstage/catalog-model';


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

  private sqlInstanceToResource(instance: sql.protos.google.cloud.sql.v1.IDatabaseInstance): DeferredEntity | undefined {
    if (!instance.name) {
      return undefined;
    }
    const location = `${this.getProviderName()}:${instance.region ?? 'europe-west1'}`;

    return {
      entity: {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Resource',
        metadata: {
          name: instance.name,
          annotations: {
            [ANNOTATION_LOCATION]: location,
            [ANNOTATION_ORIGIN_LOCATION]: location,
            [ANNOTATION_GCP_PROJECT_ID]: instance.project ?? '',
            [ANNOTATION_GCP_REGION]: instance.region ?? 'europe-west1',
          },
          namespace: 'cloudsql-instances',
        },
        spec: {
          type: 'cloudsql-instance',
          owner: this.getOwnerReference(instance),
        },
      },
    };
  }

  public async getResources(): Promise<DeferredEntity[]> {
    const instances = await Promise.all(
      this.config.getStringArray("projects").map(async project => {
        this.logger.info(`Discovering buckets in project: ${project}`);
        const [ response ] = await this.client.list({
          project: project,
          maxResults: 1000,
        });
        const sqlInstances = response.items ?? [];
        this.logger.info(`Found ${instances.length} sql instances in project: ${project}`);
        return sqlInstances
          .filter(instance => instance !== undefined)
          .map(instance => this.sqlInstanceToResource(instance))
          .filter(instance => instance !== undefined) ?? [];
      }),
    );
    return instances.flat();
  }
}
