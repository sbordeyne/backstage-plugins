import { TestDatabases, mockServices } from '@backstage/backend-test-utils';
import type { KubespecResourceDefinition } from '@sbordeyne/kubespec-common';
import fs from 'fs';

import { deserializeDefinition, serializeDefinition } from '../kube/serialize';
import { KubespecStore, metadataDir, migrationsDir } from './KubespecStore';
import { decodeVersionCursor } from './cursors';
import type { IngestVersionInput, NewResource } from './types';

jest.setTimeout(120_000);

const definition: KubespecResourceDefinition = {
  description: 'A deployment.',
  properties: [
    { name: 'apiVersion', type: 'string', isArray: false, required: false, description: 'The API version.' },
    {
      name: 'spec',
      type: 'DeploymentSpec',
      isArray: false,
      required: true,
      description: 'The desired behaviour.',
      children: [{ name: 'replicas', type: 'integer', isArray: false, required: false, description: 'How many pods.' }],
    },
  ],
};

function resource(overrides: Partial<NewResource> = {}): NewResource {
  const serialized = serializeDefinition(definition);
  return {
    apiGroup: 'apps',
    apiVersion: 'v1',
    apiVersionFull: 'apps/v1',
    kind: 'Deployment',
    category: 'Workloads',
    scope: 'Namespaced',
    description: definition.description,
    propertyCount: 3,
    treeDepth: 1,
    definitionGzip: serialized.gzip,
    definitionBytes: serialized.bytes,
    definitionHash: serialized.hash,
    truncated: false,
    properties: [
      {
        seq: 0,
        path: '.spec',
        name: 'spec',
        type: 'DeploymentSpec',
        isArray: false,
        required: true,
        depth: 0,
        description: 'The desired behaviour.',
      },
      {
        seq: 1,
        path: '.spec.replicas',
        name: 'replicas',
        type: 'integer',
        isArray: false,
        required: false,
        depth: 1,
        description: 'How many pods.',
      },
    ],
    ...overrides,
  };
}

function version(overrides: Partial<IngestVersionInput['version']> = {}): IngestVersionInput['version'] {
  return {
    sourceSlug: 'kubernetes',
    version: 'v1.33',
    upstreamRef: 'v1.33.0',
    sortKey: '0000000001.0000000033.0000000000.1.',
    contentHash: 'hash-v1-33',
    sourceBytes: 1234,
    ...overrides,
  };
}

describe('KubespecStore', () => {
  // Docker is opt-in: CI runs on arc-runner-nodejs, which has no docker daemon,
  // and TestDatabases enables containers whenever CI is set. Default runs are
  // SQLite-only; `BACKSTAGE_TEST_ENABLE_DOCKER=1` adds the Postgres pass that
  // matches app-config.production.yaml.
  const databases = TestDatabases.create({
    ids: ['SQLITE_3', 'POSTGRES_17'],
    disableDocker: !process.env.BACKSTAGE_TEST_ENABLE_DOCKER,
  });

  async function createStore(databaseId: Parameters<typeof databases.init>[0]): Promise<KubespecStore> {
    const knex = await databases.init(databaseId);
    return KubespecStore.create({ database: mockServices.database({ knex }) });
  }

  it('ships the directories that production resolves at runtime', () => {
    // package.json `files` must list both, or they exist in dev and CI but not in
    // the built image — and the failure only shows up after a deploy.
    expect(fs.existsSync(migrationsDir)).toBe(true);
    expect(fs.existsSync(metadataDir)).toBe(true);
  });

  describe.each(databases.eachSupportedId())('%s', databaseId => {
    let store: KubespecStore;

    beforeEach(async () => {
      store = await createStore(databaseId);
      await store.knex('kubespec_sources').del();
      await store.upsertSource({
        slug: 'kubernetes',
        name: 'Kubernetes',
        kind: 'kubernetes',
        repo: 'kubernetes/kubernetes',
        displayOrder: 0,
      });
    });

    async function ingest(overrides: Partial<IngestVersionInput> = {}): Promise<string> {
      return store.ingestVersion({
        version: version(),
        resources: [resource()],
        summaries: [],
        ...overrides,
      });
    }

    it('round-trips the schema blob byte for byte', async () => {
      // The one deliberate deviation from this repo's "JSON as text" rule. bytea
      // and blob both round-trip a Buffer, but a driver that hands back anything
      // else would corrupt every schema, so it is asserted rather than assumed.
      const written = resource();
      const versionId = await ingest({ resources: [written] });

      const read = await store.getResource(versionId, {
        apiGroup: 'apps',
        apiVersion: 'v1',
        kind: 'Deployment',
      });

      expect(Buffer.isBuffer(read!.definitionGzip)).toBe(true);
      expect(read!.definitionGzip.equals(written.definitionGzip)).toBe(true);
      expect(deserializeDefinition(read!.definitionGzip)).toEqual(definition);
      expect(read!.definitionHash).toBe(written.definitionHash);
    });

    it('hides a version until ingest finishes', async () => {
      const versionId = await ingest();
      await store.knex('kubespec_versions').where('id', versionId).update({ state: 'ingesting' });

      expect(await store.resolveVersion('kubernetes', 'v1.33')).toBeUndefined();
      expect(await store.listVersions({ sourceSlug: 'kubernetes', limit: 10 })).toEqual({
        items: [],
        nextCursor: undefined,
      });
    });

    it('replaces a version wholesale when it is ingested again', async () => {
      const first = await ingest();
      const second = await ingest();

      expect(second).not.toBe(first);
      expect(await store.knex('kubespec_versions').where('source_slug', 'kubernetes')).toHaveLength(1);
      // The cascade cleared the old resources rather than leaving them orphaned.
      expect(await store.knex('kubespec_resources')).toHaveLength(1);
    });

    it('resolves latest, and reports which version that is', async () => {
      await ingest();
      const newer = await ingest({
        version: version({ version: 'v1.34', sortKey: '0000000001.0000000034.0000000000.1.' }),
      });
      await store.setLatestVersion('kubernetes', newer);

      expect(await store.resolveVersion('kubernetes')).toMatchObject({ version: 'v1.34', isLatest: true });
      expect(await store.resolveVersion('kubernetes', 'latest')).toMatchObject({ version: 'v1.34' });
      expect(await store.resolveVersion('kubernetes', 'v1.33')).toMatchObject({ version: 'v1.33', isLatest: false });
      expect(await store.resolveVersion('kubernetes', 'v9.99')).toBeUndefined();
    });

    it('still resolves latest when the flag points at a version that failed', async () => {
      // Exactly what a live database ended up in: a version served as latest,
      // a later ingest of it failed, and every `latest` lookup answered 404
      // while three perfectly readable versions sat underneath it.
      const older = await ingest();
      const newer = await ingest({
        version: version({ version: 'v1.34', sortKey: '0000000001.0000000034.0000000000.1.' }),
      });
      await store.setLatestVersion('kubernetes', newer);
      await store.markVersionFailed('kubernetes', 'v1.34', 'interrupted');

      const resolved = await store.resolveVersion('kubernetes');

      expect(resolved).toMatchObject({ id: older, version: 'v1.33' });
    });

    it('clears the latest flag from a version it marks failed', async () => {
      const versionId = await ingest();
      await store.setLatestVersion('kubernetes', versionId);
      await store.markVersionFailed('kubernetes', 'v1.33', 'interrupted');

      const [row] = await store.knex('kubespec_versions').where('id', versionId).select('is_latest');
      expect(Boolean(row.is_latest)).toBe(false);
    });

    it('falls back to the newest readable version when no flag is set at all', async () => {
      // A run interrupted before it could move the flag leaves none set.
      await ingest();
      await ingest({ version: version({ version: 'v1.34', sortKey: '0000000001.0000000034.0000000000.1.' }) });

      expect(await store.resolveVersion('kubernetes')).toMatchObject({ version: 'v1.34' });
    });

    it('pages versions newest first, without skipping or repeating a tie', async () => {
      const sortKey = '0000000001.0000000033.0000000000.1.';
      await ingest({ version: version({ version: 'a', sortKey }) });
      await ingest({ version: version({ version: 'b', sortKey }) });
      await ingest({ version: version({ version: 'c', sortKey }) });

      const first = await store.listVersions({ sourceSlug: 'kubernetes', limit: 2 });
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).toBeDefined();

      const second = await store.listVersions({
        sourceSlug: 'kubernetes',
        limit: 2,
        cursor: decodeVersionCursor(first.nextCursor!),
      });

      const seen = [...first.items, ...second.items].map(item => item.version);
      expect(new Set(seen).size).toBe(3);
      expect(second.nextCursor).toBeUndefined();
    });

    it('lists resources without their schemas', async () => {
      const versionId = await ingest();
      const items = await store.listResources(versionId);

      expect(items).toEqual([
        expect.objectContaining({
          group: 'apps',
          apiVersion: 'v1',
          apiVersionFull: 'apps/v1',
          kind: 'Deployment',
          category: 'Workloads',
          scope: 'Namespaced',
          propertyCount: 3,
          hasMetadata: false,
        }),
      ]);
      expect(items[0]).not.toHaveProperty('definitionGzip');
    });

    it('stores change summaries and pages their change lists', async () => {
      const previousId = await ingest();
      await store.ingestVersion({
        version: version({ version: 'v1.34', sortKey: '0000000001.0000000034.0000000000.1.' }),
        resources: [resource()],
        summaries: [
          {
            apiGroup: 'apps',
            apiVersion: 'v1',
            kind: 'Deployment',
            previousVersionId: previousId,
            isNewGvk: false,
            isRemovedGvk: false,
            addedCount: 2,
            removedCount: 0,
            descriptionChangedCount: 1,
            descriptionChangedPaths: 7,
            typeChangedCount: 0,
            typeChangedPaths: 0,
            changes: [
              { changeType: 'new', path: '.spec.a', pathCount: 1, depth: 1 },
              { changeType: 'new', path: '.spec.b', pathCount: 1, depth: 1 },
              {
                changeType: 'description',
                path: '.spec.c',
                pathCount: 7,
                paths: ['.spec.c'],
                depth: 1,
                previousValue: 'old',
                nextValue: 'new',
                diff: [{ value: 'new', kind: 'added' }],
              },
            ],
          },
        ],
      });

      const summaries = await store.listChangeSummaries({
        sourceSlug: 'kubernetes',
        sortKey: '0000000001.0000000034.0000000000.1.',
        key: { apiGroup: 'apps', apiVersion: 'v1', kind: 'Deployment' },
      });

      expect(summaries).toEqual([
        expect.objectContaining({
          version: 'v1.34',
          previousVersion: 'v1.33',
          addedCount: 2,
          descriptionChangedCount: 1,
          descriptionChangedPaths: 7,
        }),
      ]);

      const key = { apiGroup: 'apps', apiVersion: 'v1', kind: 'Deployment' };
      const newest = (await store.resolveVersion('kubernetes', 'v1.34'))!;

      const added = await store.listChanges({ versionId: newest.id, key, changeType: 'new', limit: 10 });
      expect(added.items.map(change => change.path)).toEqual(['.spec.a', '.spec.b']);

      const all = await store.listChanges({ versionId: newest.id, key, limit: 2 });
      expect(all.items).toHaveLength(2);
      expect(all.nextCursor).toBeDefined();

      const rest = await store.listChanges({ versionId: newest.id, key, limit: 2, cursor: Number(all.nextCursor) });
      expect(rest.items[0]).toMatchObject({
        changeType: 'description',
        pathCount: 7,
        paths: ['.spec.c'],
        diff: [{ value: 'new', kind: 'added' }],
      });
    });

    it('ranks an exact kind match above a substring match', async () => {
      const versionId = await ingest({
        resources: [
          resource(),
          resource({ kind: 'DeploymentConfig', apiGroup: 'apps', apiVersion: 'v1' }),
          resource({ kind: 'Pod', apiGroup: '', apiVersion: 'v1', apiVersionFull: 'v1', description: 'a deployment' }),
        ],
      });
      await store.setLatestVersion('kubernetes', versionId);

      const hits = await store.searchResources({ needle: 'deployment', limit: 10 });
      expect(hits.items.map(hit => hit.kind)).toEqual(['Deployment', 'DeploymentConfig', 'Pod']);
    });

    it('escapes wildcards in a search needle', async () => {
      const versionId = await ingest({ resources: [resource({ kind: 'Deployment' })] });
      await store.setLatestVersion('kubernetes', versionId);

      // Unescaped, '%' would match every kind.
      expect(await store.searchResources({ needle: '%', limit: 10 })).toEqual({
        items: [],
        nextCursor: undefined,
      });
    });

    it('searches property paths within a version', async () => {
      const versionId = await ingest();
      const hits = await store.searchProperties({ needle: 'replicas', versionId, limit: 10 });

      expect(hits.items).toEqual([
        expect.objectContaining({ path: '.spec.replicas', kind: 'Deployment', type: 'integer' }),
      ]);
    });

    it('drops property rows for versions that are no longer the latest', async () => {
      const older = await ingest();
      const newer = await ingest({
        version: version({ version: 'v1.34', sortKey: '0000000001.0000000034.0000000000.1.' }),
      });

      expect(await store.pruneProperties('kubernetes', newer)).toBeGreaterThan(0);
      expect(await store.searchProperties({ needle: 'replicas', versionId: older, limit: 10 })).toEqual({
        items: [],
        nextCursor: undefined,
      });
      expect((await store.searchProperties({ needle: 'replicas', versionId: newer, limit: 10 })).items).toHaveLength(1);
    });

    it('prunes versions that are no longer planned', async () => {
      await ingest();
      await ingest({ version: version({ version: 'v1.34', sortKey: '0000000001.0000000034.0000000000.1.' }) });

      expect(await store.pruneVersions('kubernetes', ['v1.34'])).toBe(1);
      expect((await store.listStoredVersions('kubernetes')).map(item => item.version)).toEqual(['v1.34']);
    });

    it('loads metadata and flags the resources that have it', async () => {
      const versionId = await ingest();

      await store.replaceMetadata(
        [
          {
            sourceSlug: 'kubernetes',
            apiVersionFull: 'apps/v1',
            kindLower: 'deployment',
            slug: 'basic',
            ordinal: 1,
            title: 'A basic deployment',
            description: 'Three replicas.',
            content: 'apiVersion: apps/v1',
            contentHash: 'abc',
          },
        ],
        [
          {
            sourceSlug: 'kubernetes',
            apiVersionFull: 'apps/v1',
            kindLower: 'deployment',
            ordinal: 0,
            name: 'Kubernetes docs',
            href: 'https://kubernetes.io',
          },
        ],
      );
      await store.refreshHasMetadata();

      const metadata = await store.getMetadata('kubernetes', 'apps/v1', 'Deployment');
      expect(metadata.examples).toEqual([
        expect.objectContaining({ slug: 'basic', ordinal: 1, title: 'A basic deployment' }),
      ]);
      expect(metadata.links).toEqual([{ name: 'Kubernetes docs', href: 'https://kubernetes.io' }]);

      expect((await store.listResources(versionId))[0].hasMetadata).toBe(true);
    });

    it('summarises sources with their version counts', async () => {
      const versionId = await ingest();
      await store.setLatestVersion('kubernetes', versionId);
      await store.recordSourceSync('kubernetes', { status: 'ok', tagsEtag: 'W/"abc"' });

      expect(await store.listSources()).toEqual([
        expect.objectContaining({
          slug: 'kubernetes',
          versionCount: 1,
          latestVersion: 'v1.33',
          lastSyncStatus: 'ok',
          repoUrl: 'https://github.com/kubernetes/kubernetes',
        }),
      ]);
      expect(await store.getSourceTagsEtag('kubernetes')).toBe('W/"abc"');
    });

    it('keeps the stored ETag when a sync reports none', async () => {
      await store.recordSourceSync('kubernetes', { status: 'ok', tagsEtag: 'W/"abc"' });
      // A 304 produces no new ETag, and losing the old one would make every
      // subsequent listing unconditional.
      await store.recordSourceSync('kubernetes', { status: 'ok' });

      expect(await store.getSourceTagsEtag('kubernetes')).toBe('W/"abc"');
    });
  });
});
