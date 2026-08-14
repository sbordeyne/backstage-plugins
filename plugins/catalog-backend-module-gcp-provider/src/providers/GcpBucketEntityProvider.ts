import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { google, storage_v1 } from 'googleapis';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';

/** Cloud Storage buckets. */
export class GcpBucketEntityProvider extends GcpRestEntityProvider<storage_v1.Storage> {
  getProviderName(): string {
    return 'gcp-bucket';
  }

  getProviderConfigKey(): string {
    return 'storage';
  }

  getClient(): storage_v1.Storage {
    return google.storage({ version: 'v1', auth: this.googleAuth });
  }

  private bucketToResource(bucket: storage_v1.Schema$Bucket, project: string): DeferredEntity | undefined {
    if (!bucket.name) {
      return undefined;
    }
    // Storage reports locations in upper case (`EUROPE-WEST1`, `US`); every other provider and the
    // `locations` filter work in lower case.
    const region = bucket.location?.toLocaleLowerCase();
    if (!this.includesLocation(region)) {
      return undefined;
    }
    const storageClass = bucket.storageClass ?? 'Standard';

    return this.toEntity({
      name: bucket.name,
      projectId: project,
      type: 'bucket',
      region,
      selfLink: bucket.selfLink,
      labels: bucket.labels,
      summary: `${storageClass} storage bucket in ${region ?? 'an unreported location'}`,
      consolePath: `storage/browser/${bucket.name}`,
      logFilter: `resource.type="gcs_bucket" resource.labels.bucket_name="${bucket.name}"`,
      tagValues: [storageClass, bucket.locationType],
      // Cloud Asset Inventory names a bucket by itself, since bucket names are globally unique.
      assetName: `//storage.googleapis.com/${bucket.name}`,
    });
  }

  public async getResources(): Promise<DeferredEntity[]> {
    return this.forEachProject(async project => {
      const buckets = await this.listAll<storage_v1.Schema$Bucket>(async pageToken => {
        const { data } = await this.client.buckets.list({ project, pageToken });
        return { items: data.items, nextPageToken: data.nextPageToken };
      });
      return buckets.map(bucket => this.bucketToResource(bucket, project)).filter(entity => entity !== undefined);
    });
  }
}
