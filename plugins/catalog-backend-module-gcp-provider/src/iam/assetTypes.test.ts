import { parseAsset } from './assetTypes';

describe('parseAsset', () => {
  it('reads a bucket, whose name is not scoped by project', () => {
    const parsed = parseAsset('//storage.googleapis.com/projects/_/buckets/reports', 'storage.googleapis.com/Bucket');
    expect(parsed).toMatchObject({
      leaf: 'reports',
      // `projects/_` is a placeholder, not a project.
      projectId: undefined,
      mapping: { configKey: 'storage', provider: 'gcp-bucket', type: 'bucket' },
    });
  });

  it('reads the project out of a topic name', () => {
    const parsed = parseAsset('//pubsub.googleapis.com/projects/prod/topics/orders', 'pubsub.googleapis.com/Topic');
    expect(parsed).toMatchObject({
      leaf: 'orders',
      projectId: 'prod',
      mapping: { configKey: 'pubsub', type: 'pubsub-topic', nameStyle: 'pubsub' },
    });
  });

  it('rejects a project number, which no entity is named after', () => {
    const parsed = parseAsset(
      '//secretmanager.googleapis.com/projects/47603036561/secrets/pg-db-pass',
      'secretmanager.googleapis.com/Secret',
    );
    // Cloud Asset Inventory identifies the project by number for several services. Entities are
    // named by project id, so the caller's own id has to stand in.
    expect(parsed).toMatchObject({ leaf: 'pg-db-pass', projectId: undefined });
  });

  it('reads the region of a regional resource', () => {
    const parsed = parseAsset(
      '//compute.googleapis.com/projects/prod/regions/europe-west1/subnetworks/apps',
      'compute.googleapis.com/Subnetwork',
    );
    expect(parsed).toMatchObject({ leaf: 'apps', projectId: 'prod', region: 'europe-west1' });
  });

  it('reads the zone of a zonal resource', () => {
    const parsed = parseAsset(
      '//compute.googleapis.com/projects/prod/zones/europe-west1-b/instances/worker-1',
      'compute.googleapis.com/Instance',
    );
    expect(parsed).toMatchObject({ leaf: 'worker-1', region: 'europe-west1-b' });
  });

  it('reads a service account, which is named by its email', () => {
    const parsed = parseAsset(
      '//iam.googleapis.com/projects/prod/serviceAccounts/auth-sa@prod.iam.gserviceaccount.com',
      'iam.googleapis.com/ServiceAccount',
    );
    expect(parsed).toMatchObject({
      leaf: 'auth-sa@prod.iam.gserviceaccount.com',
      mapping: { nameStyle: 'serviceAccount' },
    });
  });

  it('yields nothing for an asset type this module does not ingest', () => {
    expect(
      parseAsset('//apigee.googleapis.com/organizations/prod', 'apigee.googleapis.com/Organization'),
    ).toBeUndefined();
  });
});
