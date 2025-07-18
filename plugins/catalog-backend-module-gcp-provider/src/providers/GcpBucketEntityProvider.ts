import { ANNOTATION_GCP_PROJECT_ID, ANNOTATION_GCP_REGION } from "../constants";
import { GcpEntityProviderBase } from "./GcpEntityProviderBase";
import * as storage from '@google-cloud/storage';
import {
  DeferredEntity
} from '@backstage/plugin-catalog-node';
import {
  ANNOTATION_LOCATION,
  ANNOTATION_ORIGIN_LOCATION,
} from '@backstage/catalog-model';

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

  private bucketToResource(
    bucket: storage.Bucket,
  ): DeferredEntity | undefined {
    if (!bucket.metadata || !bucket.metadata.name) {
      return undefined;
    }
    const location = `${this.getProviderName()}:${bucket.metadata.location ?? 'europe-west1'}`;

    const rawLabels = bucket.metadata.labels ?? {};
    const bucketLabels: Record<string, string> = Object.fromEntries(
      Object.entries(rawLabels).filter(([_, v]) => typeof v === 'string' && v !== null)
    ) as Record<string, string>;


    const deferredEntity: DeferredEntity = {
      entity: {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Resource',
        metadata: {
          name: bucket.name,
          annotations: {
            [ANNOTATION_LOCATION]: location,
            [ANNOTATION_ORIGIN_LOCATION]: location,
            [ANNOTATION_GCP_PROJECT_ID]: bucket.projectId ?? '',
            [ANNOTATION_GCP_REGION]: bucket.metadata.location ?? 'europe-west1',
          },
          labels: bucketLabels,
          namespace: 'buckets',
        },
        spec: {
          type: 'bucket',
          owner: this.getOwnerReference(bucket),
        },
      },
    };

    return deferredEntity;
  }

  public async getResources(): Promise<DeferredEntity[]> {
    const resources = await Promise.all(
      this.config.getStringArray("projects").map(async project => {
        this.logger.info(`Discovering buckets in project: ${project}`);
        const [buckets] = await this.client.getBuckets({
          autoPaginate: true,
          project: project,
        });
        this.logger.info(`Found ${buckets.length} buckets in project: ${project}`);
        return buckets
          .filter(bucket => bucket !== undefined)
          .map(bucket => this.bucketToResource(bucket))
          .filter(bucket => bucket !== undefined) ?? [];
      }),
    );
    return resources.flat();
  }
}
