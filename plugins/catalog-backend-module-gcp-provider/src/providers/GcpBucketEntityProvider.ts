import { GcpEntityProviderBase } from './GcpEntityProviderBase';
import * as storage from '@google-cloud/storage';
import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { ANNOTATION_LOCATION, ANNOTATION_ORIGIN_LOCATION } from '@backstage/catalog-model';

export class GcpBucketEntityProvider extends GcpEntityProviderBase<storage.Storage> {
  getProviderName(): string {
    return 'gcp-bucket';
  }

  getProviderConfigKey(): string {
    return 'storage';
  }

  getClient(): storage.Storage {
    return new storage.Storage({ credentials: this.credentials });
  }

  private bucketToResource(bucket: storage.Bucket, project: string): DeferredEntity | undefined {
    if (!bucket.metadata || !bucket.metadata.name) {
      return undefined;
    }
    const region = bucket.metadata.location ?? this.defaultRegion;
    const location = `${this.getProviderName()}:${region ?? 'unknown-region'}`;
    const labels = bucket.metadata.labels;

    const deferredEntity: DeferredEntity = {
      entity: {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Resource',
        metadata: this.metadataOf({
          name: bucket.name,
          projectId: bucket.projectId ?? project,
          type: 'bucket',
          region,
          selfLink: bucket.metadata.selfLink,
          labels,
          summary: `${bucket.metadata.storageClass ?? 'Standard'} storage bucket in ${
            region ?? 'an unreported location'
          }`,
          consolePath: `storage/browser/${bucket.name}`,
          logFilter: `resource.type="gcs_bucket" resource.labels.bucket_name="${bucket.name}"`,
          tagValues: [bucket.metadata.storageClass, bucket.metadata.locationType],
          annotations: {
            [ANNOTATION_LOCATION]: location,
            [ANNOTATION_ORIGIN_LOCATION]: location,
          },
        }),
        spec: {
          type: 'bucket',
          owner: this.ownerOf(labels),
          ...this.systemOf(labels),
        },
      },
    };

    return deferredEntity;
  }

  public async getResources(): Promise<DeferredEntity[]> {
    const buckets = await Promise.all(
      this.config.getStringArray('projects').map(async project => {
        this.logger.info(`Discovering buckets in project: ${project}`);
        const [projectBuckets] = await this.client.getBuckets({
          autoPaginate: true,
          project: project,
        });
        this.logger.info(`Found ${projectBuckets.length} buckets in project: ${project}`);
        return (
          projectBuckets
            .filter(bucket => bucket !== undefined)
            .map(bucket => this.bucketToResource(bucket, project))
            .filter(bucket => bucket !== undefined) ?? []
        );
      }),
    );
    return buckets.flat();
  }
}
