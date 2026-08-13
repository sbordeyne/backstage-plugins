import { GcpEntityProviderBase } from './GcpEntityProviderBase';
import * as bigquery from '@google-cloud/bigquery';
import { DeferredEntity } from '@backstage/plugin-catalog-node';

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
          const labels = dataset.metadata?.labels;
          const datasetId = dataset.id ?? dataset.metadata?.name ?? 'unknown';
          return {
            entity: {
              apiVersion: 'backstage.io/v1alpha1',
              kind: 'Resource',
              metadata: this.metadataOf({
                name: datasetId,
                projectId: project,
                type: 'bigquery-dataset',
                region: dataset.location,
                selfLink: dataset.metadata?.selfLink,
                labels,
                title: dataset.metadata?.friendlyName,
                description: dataset.metadata?.description,
                summary: `BigQuery dataset in ${dataset.location ?? 'an unreported location'}`,
                consolePath: `bigquery?d=${encodeURIComponent(datasetId)}&page=dataset`,
                logFilter: `resource.type="bigquery_dataset" resource.labels.dataset_id="${datasetId}"`,
              }),
              spec: {
                type: 'bigquery-dataset',
                owner: this.ownerOf(labels),
                ...this.systemOf(labels),
              },
            },
          };
        });
      }),
    );
    return bigqueries.flat();
  }
}
