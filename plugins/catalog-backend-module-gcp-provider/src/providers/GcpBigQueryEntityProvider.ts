import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { bigquery_v2, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { apiSelfLink } from '../utils';

/**
 * One entry of a dataset listing.
 *
 * `datasets.list` returns a trimmed form of the dataset rather than the full resource — it carries
 * the reference, labels, location and friendly name, but no description or self link. Reading those
 * would cost a `datasets.get` per dataset, which is not worth one round trip each.
 */
type GcpDatasetListEntry = NonNullable<bigquery_v2.Schema$DatasetList['datasets']>[number];

/** BigQuery datasets. */
export class GcpBigQueryEntityProvider extends GcpRestEntityProvider<bigquery_v2.Bigquery> {
  getProviderName(): string {
    return 'gcp-bigquery';
  }

  getProviderConfigKey(): string {
    return 'bigquery';
  }

  getClient(): bigquery_v2.Bigquery {
    return google.bigquery({ version: 'v2', auth: this.googleAuth });
  }

  private datasetToResource(dataset: GcpDatasetListEntry, project: string): DeferredEntity | undefined {
    const datasetId = dataset.datasetReference?.datasetId;
    if (!datasetId) {
      return undefined;
    }
    const projectId = dataset.datasetReference?.projectId ?? project;
    // BigQuery reports locations in upper case for the multi-regions (`EU`, `US`).
    const region = dataset.location?.toLocaleLowerCase();
    if (!this.includesLocation(region)) {
      return undefined;
    }

    return this.toEntity({
      name: datasetId,
      projectId,
      type: 'bigquery-dataset',
      region,
      // The dataset listing carries no self link, so the canonical REST URL stands in for one.
      selfLink: apiSelfLink('bigquery.googleapis.com', 'bigquery/v2', `projects/${projectId}/datasets/${datasetId}`),
      labels: dataset.labels,
      title: dataset.friendlyName,
      summary: `BigQuery dataset in ${region ?? 'an unreported location'}`,
      consolePath: `bigquery?d=${encodeURIComponent(datasetId)}&page=dataset`,
      logFilter: `resource.type="bigquery_dataset" resource.labels.dataset_id="${datasetId}"`,
      assetName: `//bigquery.googleapis.com/projects/${projectId}/datasets/${datasetId}`,
    });
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const datasets = await this.listAll<GcpDatasetListEntry>(async pageToken => {
        const { data } = await this.client.datasets.list({ projectId: project, pageToken });
        return { items: data.datasets, nextPageToken: data.nextPageToken };
      });
      return datasets.map(dataset => this.datasetToResource(dataset, project)).filter(entity => entity !== undefined);
    });
  }
}
