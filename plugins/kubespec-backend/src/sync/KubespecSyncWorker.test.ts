import { TestDatabases, mockServices } from '@backstage/backend-test-utils';
import { ConfigReader } from '@backstage/config';

import { readKubespecConfig } from '../config';
import { KubespecStore } from '../database/KubespecStore';
import type { GithubClient, GithubFile, TagListing } from '../github/GithubClient';
import { KubespecSyncWorker } from './KubespecSyncWorker';

jest.setTimeout(120_000);

const CRD = (group: string, kind: string, version = 'v1') => `apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: ${kind.toLowerCase()}s.${group}
spec:
  group: ${group}
  scope: Namespaced
  names:
    kind: ${kind}
  versions:
    - name: ${version}
      schema:
        openAPIV3Schema:
          type: object
          description: A ${kind}.
          properties:
            spec:
              type: object
              properties:
                replicas:
                  type: integer
`;

interface FakeGithubOptions {
  tags?: string[];
  /** Blob shas per tag, so a changed sha models a changed upstream. */
  shaByTag?: Record<string, string>;
  contentsByTag?: Record<string, string>;
  failListTags?: boolean;
}

function fakeGithub(options: FakeGithubOptions = {}) {
  const tags = options.tags ?? ['v1.0.0'];
  const calls = { listTags: 0, collect: 0, download: 0 };

  const client: Partial<GithubClient> & { calls: typeof calls } = {
    calls,
    requestCount: 0,
    async listTags(): Promise<TagListing> {
      calls.listTags += 1;
      if (options.failListTags) {
        throw new Error('GitHub is unreachable');
      }
      return { tags, notModified: false, etag: 'W/"etag"' };
    },
    async collectManifests({ ref }): Promise<GithubFile[]> {
      calls.collect += 1;
      return [
        {
          path: 'config/crd/widget.yaml',
          name: 'widget.yaml',
          sha: options.shaByTag?.[ref] ?? `sha-${ref}`,
          downloadUrl: `https://example.invalid/${ref}/widget.yaml`,
          size: 100,
        },
      ];
    },
    async download(_repo: string, url: string): Promise<string> {
      calls.download += 1;
      const ref = url.split('/')[3];
      return options.contentsByTag?.[ref] ?? CRD('example.com', 'Widget');
    },
  };

  return client as GithubClient & { calls: typeof calls };
}

function config(overrides: Record<string, unknown> = {}) {
  return readKubespecConfig(
    new ConfigReader({
      kubespec: {
        sync: { enabled: true, maxVersionsPerTick: 60 },
        projects: [
          {
            slug: 'widgets',
            name: 'Widgets',
            repo: 'example/widgets',
            paths: ['config/crd'],
            tags: { max: 10 },
          },
        ],
        ...overrides,
      },
    }),
  );
}

describe('KubespecSyncWorker', () => {
  const databases = TestDatabases.create({ ids: ['SQLITE_3'], disableDocker: true });

  async function createWorker(github: GithubClient, kubespecConfig = config()) {
    const knex = await databases.init('SQLITE_3');
    const store = await KubespecStore.create({ database: mockServices.database({ knex }) });
    const worker = new KubespecSyncWorker({
      store,
      github,
      logger: mockServices.logger.mock(),
      config: kubespecConfig,
    });
    return { store, worker };
  }

  it('ingests a version and marks it latest', async () => {
    const github = fakeGithub({ tags: ['v1.0.0', 'v1.1.0'] });
    const { store, worker } = await createWorker(github);

    const stats = await worker.syncOnce();

    expect(stats).toMatchObject({ sourcesPlanned: 1, sourcesFailed: 0, versionsIngested: 2, versionsFailed: 0 });

    const versions = await store.listStoredVersions('widgets');
    expect(versions.map(version => version.version)).toEqual(['v1.0.0', 'v1.1.0']);
    expect(versions.find(version => version.isLatest)?.version).toBe('v1.1.0');

    const latest = (await store.resolveVersion('widgets'))!;
    expect((await store.listResources(latest.id)).map(resource => resource.kind)).toEqual(['Widget']);
  });

  it('skips a version whose content hash is unchanged, without downloading it', async () => {
    const github = fakeGithub({ tags: ['v1.0.0'] });
    const { worker } = await createWorker(github);

    await worker.syncOnce();
    const afterFirst = github.calls.download;

    const second = await worker.syncOnce();

    expect(second).toMatchObject({ versionsSkippedUnchanged: 1, versionsIngested: 0 });
    // The listing still happens — that is where the sha comes from — but nothing
    // is fetched a second time.
    expect(github.calls.download).toBe(afterFirst);
  });

  it('re-reads unchanged versions once a rebuild has been asked for', async () => {
    const github = fakeGithub({ tags: ['v1.0.0'] });
    const { store, worker } = await createWorker(github);
    await worker.syncOnce();

    // Without the flag this is skipped from its listing alone.
    expect(await worker.syncOnce()).toMatchObject({ versionsSkippedUnchanged: 1, versionsIngested: 0 });

    await store.requestForceResync();
    expect(await worker.syncOnce()).toMatchObject({ versionsSkippedUnchanged: 0, versionsIngested: 1 });

    // Cleared per source, so the rebuild does not repeat on every later tick.
    expect(await worker.syncOnce()).toMatchObject({ versionsSkippedUnchanged: 1, versionsIngested: 0 });
  });

  it('re-ingests a version whose upstream content changed', async () => {
    const github = fakeGithub({ tags: ['v1.0.0'], shaByTag: { 'v1.0.0': 'sha-one' } });
    const { store, worker } = await createWorker(github);
    await worker.syncOnce();

    const changed = fakeGithub({
      tags: ['v1.0.0'],
      shaByTag: { 'v1.0.0': 'sha-two' },
      contentsByTag: { 'v1.0.0': [CRD('example.com', 'Widget'), CRD('example.com', 'Gadget')].join('---\n') },
    });
    const second = new KubespecSyncWorker({
      store,
      github: changed,
      logger: mockServices.logger.mock(),
      config: config(),
    });

    expect(await second.syncOnce()).toMatchObject({ versionsIngested: 1, versionsSkippedUnchanged: 0 });

    const latest = (await store.resolveVersion('widgets'))!;
    expect((await store.listResources(latest.id)).map(resource => resource.kind).sort()).toEqual(['Gadget', 'Widget']);
  });

  it('diffs each version against the one before it', async () => {
    const github = fakeGithub({
      tags: ['v1.0.0', 'v1.1.0'],
      contentsByTag: {
        'v1.0.0': CRD('example.com', 'Widget'),
        'v1.1.0': [CRD('example.com', 'Widget'), CRD('example.com', 'Gadget')].join('---\n'),
      },
    });
    const { store, worker } = await createWorker(github);
    await worker.syncOnce();

    const latest = (await store.resolveVersion('widgets'))!;
    const summaries = await store.listChangeSummaries({
      sourceSlug: 'widgets',
      sortKey: latest.sortKey,
      key: { apiGroup: 'example.com', apiVersion: 'v1', kind: 'Gadget' },
    });

    // Gadget only exists in the newer version, so it is new rather than a wall of
    // additions for every property it happens to have.
    expect(summaries[0]).toMatchObject({ version: 'v1.1.0', isNewGvk: true, addedCount: 0 });
  });

  it('stops ingesting once the per-tick budget is spent', async () => {
    const github = fakeGithub({ tags: ['v1.0.0', 'v1.1.0', 'v1.2.0'] });
    const { store, worker } = await createWorker(github, config({ sync: { enabled: true, maxVersionsPerTick: 2 } }));

    const stats = await worker.syncOnce();

    expect(stats).toMatchObject({ versionsIngested: 2, versionsSkippedOverBudget: 1 });
    expect(await store.listStoredVersions('widgets')).toHaveLength(2);
  });

  it('stops when the tick runs out of time and leaves the rest for the next one', async () => {
    // A tick that is cut off by the scheduler leaves its ticket behind, and that
    // ticket is what blocks the next manual sync until the janitor clears it. So
    // the tick stops itself instead.
    const github = fakeGithub({ tags: ['v1.0.0', 'v1.1.0', 'v1.2.0'] });
    const { store, worker } = await createWorker(
      github,
      config({ sync: { enabled: true, maxTickDurationMinutes: 0 } }),
    );

    const stats = await worker.syncOnce();

    expect(stats).toMatchObject({ versionsIngested: 0, versionsSkippedOutOfTime: 3 });
    // Nothing was half-written: the source is planned and visible, with no
    // versions yet.
    expect(await store.listStoredVersions('widgets')).toEqual([]);
    expect((await store.listSources()).map(source => source.slug)).toEqual(['widgets']);
  });

  it('resumes the remaining versions on the next tick', async () => {
    const github = fakeGithub({ tags: ['v1.0.0', 'v1.1.0'] });
    const { store, worker } = await createWorker(github, config({ sync: { enabled: true, maxVersionsPerTick: 1 } }));

    await worker.syncOnce();
    expect(await store.listStoredVersions('widgets')).toHaveLength(1);

    const second = await worker.syncOnce();

    // The version already stored is recognised from its listing and skipped, so
    // the second tick spends its budget on what is actually missing.
    expect(second).toMatchObject({ versionsSkippedUnchanged: 1, versionsIngested: 1 });
    expect((await store.listStoredVersions('widgets')).map(version => version.version)).toEqual(['v1.0.0', 'v1.1.0']);
  });

  it('prunes versions that dropped out of the plan', async () => {
    const { store, worker } = await createWorker(fakeGithub({ tags: ['v1.0.0', 'v1.1.0'] }));
    await worker.syncOnce();

    const narrowed = new KubespecSyncWorker({
      store,
      github: fakeGithub({ tags: ['v1.1.0'] }),
      logger: mockServices.logger.mock(),
      config: config(),
    });
    const stats = await narrowed.syncOnce();

    expect(stats.versionsPruned).toBe(1);
    expect((await store.listStoredVersions('widgets')).map(version => version.version)).toEqual(['v1.1.0']);
  });

  it('never prunes a source whose plan failed', async () => {
    const { store, worker } = await createWorker(fakeGithub({ tags: ['v1.0.0'] }));
    await worker.syncOnce();

    const broken = new KubespecSyncWorker({
      store,
      github: fakeGithub({ failListTags: true }),
      logger: mockServices.logger.mock(),
      config: config(),
    });
    const stats = await broken.syncOnce();

    // A GitHub outage must not be read as "these versions no longer exist".
    expect(stats).toMatchObject({ sourcesFailed: 1, versionsPruned: 0, sourcesPruned: 0 });
    expect(await store.listStoredVersions('widgets')).toHaveLength(1);

    const [source] = await store.listSources();
    expect(source.lastSyncStatus).toBe('failed');
  });

  it('records a failed version without storing it', async () => {
    const github = fakeGithub({ tags: ['v1.0.0'], contentsByTag: { 'v1.0.0': 'kind: ConfigMap\n' } });
    const { store, worker } = await createWorker(github);

    const stats = await worker.syncOnce();

    // Manifests were found but held no v1 CRD, so there is nothing to browse and
    // an empty version would be worse than none.
    expect(stats).toMatchObject({ versionsFailed: 1, versionsIngested: 0 });
    expect(await store.resolveVersion('widgets')).toBeUndefined();
  });

  it('reports a version that only parsed because the reader tolerated bad YAML', async () => {
    // Upstream projects do publish malformed CRDs — flagger's crd.yaml opens a
    // quote it never closes. The data is usable, but presenting it as a clean
    // import would hide that part of it is missing.
    const malformed = `apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
spec:
  group: example.com
  scope: Namespaced
  names:
    kind: Widget
  versions:
    - name: v1
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              description: 'unterminated
              type: object
`;
    const github = fakeGithub({ tags: ['v1.0.0'], contentsByTag: { 'v1.0.0': malformed } });
    const { store, worker } = await createWorker(github);

    const stats = await worker.syncOnce();

    expect(stats).toMatchObject({ versionsIngested: 1, versionsFailed: 0 });

    const [source] = await store.listSources();
    expect(source.lastSyncStatus).toBe('partial');
  });

  it('does nothing when it is already aborted', async () => {
    const github = fakeGithub();
    const { worker } = await createWorker(github);

    const controller = new AbortController();
    controller.abort();

    expect(await worker.syncOnce(controller.signal)).toMatchObject({ sourcesPlanned: 0, versionsIngested: 0 });
    expect(github.calls.listTags).toBe(0);
  });

  it('removes a source that is no longer configured', async () => {
    const { store, worker } = await createWorker(fakeGithub());
    await worker.syncOnce();

    const emptied = new KubespecSyncWorker({
      store,
      github: fakeGithub(),
      logger: mockServices.logger.mock(),
      config: readKubespecConfig(new ConfigReader({ kubespec: { projects: [] } })),
    });

    expect(await emptied.syncOnce()).toMatchObject({ sourcesPruned: 1 });
    expect(await store.listSources()).toEqual([]);
  });
});
