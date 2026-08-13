import { ConfigReader, JsonObject } from '@backstage/config';
import { mockServices } from '@backstage/backend-test-utils';
import { Entity } from '@backstage/catalog-model';
import { cloudasset_v1 } from 'googleapis';
import { GcpAssetIndex } from '../iam';
import { GcpRelationProcessor } from './GcpRelationProcessor';

const schedule = { frequency: { hours: 1 }, timeout: { minutes: 10 } };

/** The auth account's grants: a secret it reads, a topic it publishes to, a bucket it owns. */
const POLICIES = {
  results: [
    {
      resource: '//secretmanager.googleapis.com/projects/prod/secrets/auth-jwks',
      assetType: 'secretmanager.googleapis.com/Secret',
      policy: {
        bindings: [
          {
            role: 'roles/secretmanager.secretAccessor',
            members: ['serviceAccount:auth-sa@prod.iam.gserviceaccount.com'],
          },
        ],
      },
    },
    {
      resource: '//pubsub.googleapis.com/projects/prod/topics/auth-events',
      assetType: 'pubsub.googleapis.com/Topic',
      policy: {
        bindings: [
          { role: 'roles/pubsub.publisher', members: ['serviceAccount:auth-sa@prod.iam.gserviceaccount.com'] },
        ],
      },
    },
    {
      resource: '//storage.googleapis.com/projects/_/buckets/auth-exports',
      assetType: 'storage.googleapis.com/Bucket',
      policy: {
        bindings: [
          // Two roles on one resource: the stronger verb should win.
          { role: 'roles/storage.objectViewer', members: ['serviceAccount:auth-sa@prod.iam.gserviceaccount.com'] },
          { role: 'roles/storage.admin', members: ['serviceAccount:auth-sa@prod.iam.gserviceaccount.com'] },
        ],
      },
    },
  ],
};

const AUTH_SA: Entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Resource',
  metadata: {
    name: 'auth-sa',
    namespace: 'default',
    annotations: {
      'cloud.google.com/service-account': 'auth-sa@prod.iam.gserviceaccount.com',
      'cloud.google.com/project-id': 'prod',
    },
  },
  spec: { type: 'google-service-account', owner: 'group:default/platform' },
};

function configOf(gcp: JsonObject): ConfigReader {
  return new ConfigReader({ catalog: { providers: { gcp } } });
}

function indexOf() {
  const searchAllIamPolicies = jest.fn().mockResolvedValue({ data: POLICIES });
  const client = { v1: { searchAllIamPolicies } } as unknown as cloudasset_v1.Cloudasset;
  return new GcpAssetIndex(client, mockServices.logger.mock(), { cacheTtlMs: 60_000, maxBindings: 1000 });
}

/** Runs the processor and collects the relations it emitted. */
async function relationsOf(entity: Entity, gcp: JsonObject) {
  const processor = new GcpRelationProcessor(configOf(gcp), mockServices.logger.mock(), indexOf());
  const emitted: { source: string; type: string; target: string }[] = [];
  await processor.postProcessEntity(entity, undefined, result => {
    if (result.type === 'relation') {
      const { source, type, target } = result.relation;
      emitted.push({
        source: `${source.kind}:${source.namespace}/${source.name}`.toLocaleLowerCase(),
        type,
        target: `${target.kind}:${target.namespace}/${target.name}`.toLocaleLowerCase(),
      });
    }
  });
  return emitted;
}

const GCP_MODE: JsonObject = {
  iam: { relations: 'gcp' },
  'service-account': { projects: ['prod'], schedule },
  secretmanager: { projects: ['prod'], schedule },
  pubsub: { projects: ['prod'], schedule },
  storage: { projects: ['prod'], schedule },
};

describe('GcpRelationProcessor', () => {
  it('emits nothing while the built-in vocabulary is in use', async () => {
    const builtin = { ...GCP_MODE, iam: { relations: 'builtin' } };
    await expect(relationsOf(AUTH_SA, builtin)).resolves.toEqual([]);
  });

  it('names each grant by the verb its role actually grants', async () => {
    const relations = await relationsOf(AUTH_SA, GCP_MODE);

    expect(relations).toContainEqual({
      source: 'resource:default/auth-sa',
      type: 'accessorOf',
      target: 'resource:default/auth-jwks',
    });
    expect(relations).toContainEqual({
      source: 'resource:default/auth-sa',
      type: 'publisherTo',
      target: 'resource:default/auth-events',
    });
  });

  it('emits both directions, since a custom type has no automatic reverse', async () => {
    const relations = await relationsOf(AUTH_SA, GCP_MODE);

    expect(relations).toContainEqual({
      source: 'resource:default/auth-jwks',
      type: 'accessedBy',
      target: 'resource:default/auth-sa',
    });
    expect(relations).toContainEqual({
      source: 'resource:default/auth-events',
      type: 'publishedToBy',
      target: 'resource:default/auth-sa',
    });
  });

  it('keeps the strongest verb when one account holds several roles on a resource', async () => {
    const relations = await relationsOf(AUTH_SA, GCP_MODE);
    const bucket = relations.filter(relation => relation.target === 'resource:default/auth-exports');

    expect(bucket).toEqual([
      { source: 'resource:default/auth-sa', type: 'adminOf', target: 'resource:default/auth-exports' },
    ]);
  });

  it('honours the role denylist', async () => {
    const relations = await relationsOf(AUTH_SA, {
      ...GCP_MODE,
      iam: { relations: 'gcp', excludeRoles: ['roles/pubsub.publisher'] },
    });
    expect(relations.some(relation => relation.type === 'publisherTo')).toBe(false);
  });

  it('turns a declared structural edge into its pair', async () => {
    const database: Entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Resource',
      metadata: { name: 'orders-ledger', namespace: 'default' },
      spec: {
        type: 'spanner-database',
        owner: 'group:default/platform',
        gcpRelations: [{ type: 'partOf', targetRef: 'resource:default/orders' }],
      },
    };

    await expect(relationsOf(database, GCP_MODE)).resolves.toEqual([
      { source: 'resource:default/orders-ledger', type: 'partOf', target: 'resource:default/orders' },
      { source: 'resource:default/orders', type: 'hasPart', target: 'resource:default/orders-ledger' },
    ]);
  });

  it('ignores an entity that is not a GCP service account', async () => {
    const bucket: Entity = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Resource',
      metadata: { name: 'auth-exports', namespace: 'default' },
      spec: { type: 'bucket', owner: 'group:default/platform' },
    };
    await expect(relationsOf(bucket, GCP_MODE)).resolves.toEqual([]);
  });
});
