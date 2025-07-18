import { ANNOTATION_GCP_PROJECT_ID, ANNOTATION_GCP_REGION } from "../constants";
import { GcpEntityProviderBase } from "./GcpEntityProviderBase";
import * as bigquery from '@google-cloud/bigquery';
import {
  DeferredEntity
} from '@backstage/plugin-catalog-node';


export class GcpBigQueryEntityProvider extends GcpEntityProviderBase<bigquery.BigQuery> {
  getProviderName(): string {
    return 'gcp-bigquery';
  }

  getProviderConfigKey(): string {
    return 'bigquery';
  }

  getClient(): bigquery.BigQuery {
    return new bigquery.BigQuery({ credentials: this.credentials });
  }

  async getResources(): Promise<DeferredEntity[]> {
    const bigqueries = await Promise.all(
      this.config.getStringArray("projects").map(async project => {
        const [datasets] = await this.client.getDatasets({ projectId: project });
        return datasets.map<DeferredEntity>(dataset => {
          return {
            entity: {
              apiVersion: 'backstage.io/v1alpha1',
              kind: 'Resource',
              metadata: {
                name: dataset.id ?? '',
                namespace: "bigquery-datasets",
                annotations: {
                  [ANNOTATION_GCP_PROJECT_ID]: project,
                  [ANNOTATION_GCP_REGION]: dataset.location ?? 'europe-west1',
                },
              },
              spec: {
                type: 'bigquery-dataset',
                owner: this.getOwnerReference(dataset),
              },
            }
          };
        });
      }),
    )
    return bigqueries.flat();
  }
}
