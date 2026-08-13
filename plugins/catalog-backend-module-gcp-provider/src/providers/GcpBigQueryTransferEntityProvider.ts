import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { bigquerydatatransfer_v1, google } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { apiSelfLink, formatResourceName, lastSegment, segmentAfter } from '../utils';

/**
 * BigQuery scheduled queries and data transfers.
 *
 * A transfer is a data flow into a dataset, so relating it to that dataset answers where a table's
 * contents come from — which is the question a dataset entity alone cannot.
 */
export class GcpBigQueryTransferEntityProvider extends GcpRestEntityProvider<bigquerydatatransfer_v1.Bigquerydatatransfer> {
  getProviderName(): string {
    return 'gcp-bqtransfers';
  }

  getProviderConfigKey(): string {
    return 'bqtransfers';
  }

  getClient(): bigquerydatatransfer_v1.Bigquerydatatransfer {
    return google.bigquerydatatransfer({ version: 'v1', auth: this.googleAuth });
  }

  private transferToResource(
    transfer: bigquerydatatransfer_v1.Schema$TransferConfig,
    project: string,
  ): DeferredEntity | undefined {
    const transferId = lastSegment(transfer.name);
    if (!transferId) {
      return undefined;
    }
    const region = segmentAfter(transfer.name, 'locations');
    const dataset = transfer.destinationDatasetId;
    const source = transfer.dataSourceId ?? 'an unreported source';

    return this.toEntity(
      {
        // Transfer ids are opaque, so the display name carries the meaning.
        name: formatResourceName(transfer.displayName ?? transferId),
        projectId: project,
        type: 'bigquery-transfer',
        region,
        title: transfer.displayName ?? transferId,
        selfLink: apiSelfLink('bigquerydatatransfer.googleapis.com', 'v1', transfer.name),
        summary: `${transfer.disabled ? 'Disabled transfer' : 'Transfer'} from ${source} into ${
          dataset ?? 'an unreported dataset'
        }${transfer.schedule ? `, ${transfer.schedule}` : ''}`,
        consolePath: `bigquery/transfers/location/${region}/configs/${transferId}/runs`,
        tagValues: [source, transfer.disabled ? 'disabled' : 'enabled'],
        annotations: {
          ...(transfer.schedule ? { 'cloud.google.com/schedule': transfer.schedule } : {}),
          'cloud.google.com/transfer-source': source,
        },
      },
      {
        dependsOn: dataset
          ? [
              this.resourceRef('bigquery', {
                projectId: project,
                type: 'bigquery-dataset',
                provider: 'gcp-bigquery',
                name: dataset,
              }),
            ]
          : [],
      },
    );
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const transfers = await this.listAll<bigquerydatatransfer_v1.Schema$TransferConfig>(async pageToken => {
        const { data } = await this.client.projects.locations.transferConfigs.list({
          parent: `projects/${project}/locations/-`,
          pageToken,
        });
        return { items: data.transferConfigs, nextPageToken: data.nextPageToken };
      });
      return transfers
        .map(transfer => this.transferToResource(transfer, project))
        .filter(entity => entity !== undefined);
    });
  }
}
