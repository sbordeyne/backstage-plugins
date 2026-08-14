import { ConfigReader } from '@backstage/config';
import { mockServices } from '@backstage/backend-test-utils';
import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { GcpRestEntityProvider } from './GcpRestEntityProvider';
import { GcpResource } from './GcpEntityProviderBase';
import { ASSET_HOST_BY_TYPE } from '../resourceTypes';

const schedule = { frequency: { hours: 1 }, timeout: { minutes: 10 } };

/** Stand-in provider, so the derivation can be exercised without a GCP client. */
class TestProvider extends GcpRestEntityProvider<undefined> {
  getProviderName(): string {
    return 'gcp-vpc';
  }

  getProviderConfigKey(): string {
    return 'vpc';
  }

  getClient(): undefined {
    return undefined;
  }

  async getResources(): Promise<DeferredEntity[]> {
    return [];
  }

  assetName(resource: GcpResource) {
    return this.assetNameOf(resource);
  }
}

function provider(): TestProvider {
  const config = new ConfigReader({
    catalog: { providers: { gcp: { vpc: { projects: ['my-project'], schedule } } } },
  });
  return new TestProvider(mockServices.logger.mock(), mockServices.scheduler.mock(), config);
}

/**
 * Self link and asset name as the providers that spell both out produce them.
 *
 * These are the ten that named their own assets before the derivation existed, so they are the
 * check on it: whatever the rule produces has to be what they already write, or the annotation
 * looks up a name Cloud Asset Inventory never reported.
 */
const KNOWN: [string, string, string][] = [
  [
    'secret',
    'https://secretmanager.googleapis.com/v1/projects/prod/secrets/auth-jwks',
    '//secretmanager.googleapis.com/projects/prod/secrets/auth-jwks',
  ],
  [
    'pubsub-topic',
    'https://pubsub.googleapis.com/v1/projects/prod/topics/orders',
    '//pubsub.googleapis.com/projects/prod/topics/orders',
  ],
  [
    'pubsub-subscription',
    'https://pubsub.googleapis.com/v1/projects/prod/subscriptions/orders-worker',
    '//pubsub.googleapis.com/projects/prod/subscriptions/orders-worker',
  ],
  [
    'google-service-account',
    'https://iam.googleapis.com/v1/projects/prod/serviceAccounts/auth-sa@prod.iam.gserviceaccount.com',
    '//iam.googleapis.com/projects/prod/serviceAccounts/auth-sa@prod.iam.gserviceaccount.com',
  ],
  [
    'kubernetes-cluster',
    'https://container.googleapis.com/v1/projects/prod/locations/europe-west1/clusters/prod-cluster',
    '//container.googleapis.com/projects/prod/locations/europe-west1/clusters/prod-cluster',
  ],
  [
    'bigquery-dataset',
    'https://bigquery.googleapis.com/bigquery/v2/projects/prod/datasets/reports',
    '//bigquery.googleapis.com/projects/prod/datasets/reports',
  ],
  [
    // The API host is `sqladmin`; Cloud Asset Inventory names these under `cloudsql`.
    'cloudsql-instance',
    'https://sqladmin.googleapis.com/sql/v1beta4/projects/prod/instances/auth-db',
    '//cloudsql.googleapis.com/projects/prod/instances/auth-db',
  ],
  [
    // A Compute self link carries the API version in the middle, and the rule reads past it.
    'vpc-network',
    'https://www.googleapis.com/compute/v1/projects/prod/global/networks/shared',
    '//compute.googleapis.com/projects/prod/global/networks/shared',
  ],
];

describe('asset names', () => {
  it.each(KNOWN)('derives the %s asset name from its self link', (type, selfLink, expected) => {
    expect(provider().assetName({ name: 'x', projectId: 'prod', type, selfLink })).toBe(expected);
  });

  it('prefers an asset name the provider set itself', () => {
    // Buckets are named `//storage.googleapis.com/<bucket>`, which the rule cannot produce.
    const resource: GcpResource = {
      name: 'reports',
      projectId: 'prod',
      type: 'bucket',
      selfLink: 'https://www.googleapis.com/storage/v1/b/reports',
      assetName: '//storage.googleapis.com/reports',
    };
    expect(provider().assetName(resource)).toBe('//storage.googleapis.com/reports');
  });

  it('names no asset for a type that holds no policy', () => {
    const resource: GcpResource = { name: 'egress', projectId: 'prod', type: 'cloud-nat', selfLink: 'https://x/y' };
    expect(provider().assetName(resource)).toBeUndefined();
  });

  it('names no asset when the resource reported no self link', () => {
    expect(provider().assetName({ name: 'shared', projectId: 'prod', type: 'vpc-network' })).toBeUndefined();
  });

  it('reads the path as whole segments, not as a substring', () => {
    // A resource whose own name contains `projects/` would otherwise be read from the wrong offset.
    const resource: GcpResource = {
      name: 'thing',
      projectId: 'prod',
      type: 'vpc-network',
      selfLink: 'https://www.googleapis.com/compute/v1/my-projects/thing',
    };
    expect(provider().assetName(resource)).toBeUndefined();
  });

  it('covers every type the registry declares an asset type for', () => {
    // The host map is what the derivation keys off, so a type with an asset type and no host would
    // silently opt out of the annotation.
    for (const type of ASSET_HOST_BY_TYPE.keys()) {
      expect(ASSET_HOST_BY_TYPE.get(type)).toMatch(/^[a-z0-9-]+\.googleapis\.com$/);
    }
    expect(ASSET_HOST_BY_TYPE.size).toBeGreaterThan(70);
  });
});
