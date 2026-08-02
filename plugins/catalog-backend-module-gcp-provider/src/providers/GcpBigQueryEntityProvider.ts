import { ANNOTATION_GCP_PROJECT_ID } from '../constants';
import { GcpEntityProviderBase } from './GcpEntityProviderBase';
import * as bigquery from '@google-cloud/bigquery';
import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { formatResourceName, regionAnnotation } from '../utils';

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
      this.config.getStringArray('projects').map(async project => {
        const [datasets] = await this.client.getDatasets({ projectId: project });
        return datasets.map<DeferredEntity>(dataset => {
          return {
            entity: {
              apiVersion: 'backstage.io/v1alpha1',
              kind: 'Resource',
              metadata: {
                name: formatResourceName(dataset.id ?? dataset.metadata?.name ?? 'unknown'),
                namespace: 'bigquery-datasets',
                annotations: {
                  [ANNOTATION_GCP_PROJECT_ID]: project,
                  ...regionAnnotation(dataset.location ?? this.defaultRegion),
                },
              },
              spec: {
                type: 'bigquery-dataset',
                owner: this.ownerOf(dataset.metadata?.labels),
              },
            },
          };
        });
      }),
    );
    return bigqueries.flat();
  }
}
