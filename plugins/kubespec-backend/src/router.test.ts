import type { SchedulerService } from '@backstage/backend-plugin-api';
import { TestDatabases, mockCredentials, mockServices, startTestBackend } from '@backstage/backend-test-utils';
import { ConfigReader } from '@backstage/config';
import { ConflictError } from '@backstage/errors';
import type { KubespecResourceDefinition } from '@sbordeyne/kubespec-common';
import express from 'express';
import request from 'supertest';

import { readKubespecConfig } from './config';
import { KubespecStore } from './database/KubespecStore';
import type { NewResource } from './database/types';
import { serializeDefinition } from './kube/serialize';
import { kubespecPlugin } from './plugin';
import { createRouter } from './router';

jest.setTimeout(120_000);

const definition: KubespecResourceDefinition = {
  description: 'Deployment enables declarative updates for Pods.',
  properties: [
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
    propertyCount: 2,
    treeDepth: 1,
    definitionGzip: serialized.gzip,
    definitionBytes: serialized.bytes,
    definitionHash: serialized.hash,
    truncated: false,
    properties: [
      {
        seq: 0,
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

describe('kubespec router', () => {
  const databases = TestDatabases.create({ ids: ['SQLITE_3'], disableDocker: true });

  async function startBackend(options: { syncEnabled?: boolean } = {}) {
    const knex = await databases.init('SQLITE_3');
    const backend = await startTestBackend({
      features: [
        kubespecPlugin,
        mockServices.database.factory({ knex }),
        // Sync stays off by default so the test needs no GitHub credentials, and
        // the metadata directory is a fixture rather than the shipped corpus.
        mockServices.rootConfig.factory({
          data: {
            // The plugin refuses to start with sync on and no GitHub integration,
            // so the token is here purely to get past that check; with no
            // projects configured the worker finds nothing to fetch.
            integrations: { github: [{ host: 'github.com', token: 'x' }] },
            kubespec: {
              sync: { enabled: options.syncEnabled ?? false },
              metadataDir: `${__dirname}/metadata/__fixtures__/metadata`,
              kubernetes: { minors: ['v1.33'], categoryOrder: ['Workloads', 'Cluster'] },
              projects: [],
            },
          },
        }),
      ],
    });

    const store = await KubespecStore.create({ database: mockServices.database({ knex }) });
    await store.upsertSource({
      slug: 'kubernetes',
      name: 'Kubernetes',
      kind: 'kubernetes',
      repo: 'kubernetes/kubernetes',
      displayOrder: 0,
    });

    return { backend, store, server: backend.server as unknown as express.Express };
  }

  async function seed(store: KubespecStore, resources: NewResource[] = [resource()]) {
    const versionId = await store.ingestVersion({
      version: {
        sourceSlug: 'kubernetes',
        version: 'v1.33',
        upstreamRef: 'v1.33.0',
        sortKey: '0000000001.0000000033.0000000000.1.',
        contentHash: 'hash',
        sourceBytes: 10,
      },
      resources,
      summaries: [
        {
          apiGroup: 'apps',
          apiVersion: 'v1',
          kind: 'Deployment',
          isNewGvk: false,
          isRemovedGvk: false,
          addedCount: 1,
          removedCount: 0,
          descriptionChangedCount: 0,
          descriptionChangedPaths: 0,
          typeChangedCount: 0,
          typeChangedPaths: 0,
          changes: [{ changeType: 'new', path: '.spec.paused', pathCount: 1, depth: 1 }],
        },
      ],
    });
    await store.setLatestVersion('kubernetes', versionId);
    return versionId;
  }

  function get(server: express.Express, path: string) {
    return request(server).get(path).set('Authorization', mockCredentials.user.header());
  }

  it('lists sources', async () => {
    const { store, server } = await startBackend();
    await seed(store);

    const response = await get(server, '/api/kubespec/v1/sources');

    expect(response.status).toBe(200);
    expect(response.body.items).toEqual([
      expect.objectContaining({ slug: 'kubernetes', latestVersion: 'v1.33', versionCount: 1 }),
    ]);
  });

  it('lists a version’s resources with the configured category order', async () => {
    const { store, server } = await startBackend();
    await seed(store, [
      resource(),
      resource({ kind: 'Node', apiGroup: '', apiVersionFull: 'v1', category: 'Cluster' }),
    ]);

    const response = await get(server, '/api/kubespec/v1/resources?source=kubernetes');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      sourceSlug: 'kubernetes',
      requestedVersion: 'latest',
      resolvedVersion: 'v1.33',
      isLatest: true,
      categoryOrder: ['Workloads', 'Cluster'],
    });
    expect(response.body.items.map((item: { kind: string }) => item.kind).sort()).toEqual(['Deployment', 'Node']);
  });

  it('serves the schema as the gzip bytes it was stored as', async () => {
    const { store, server } = await startBackend();
    await seed(store);

    const response = await get(
      server,
      '/api/kubespec/v1/resource/schema?source=kubernetes&group=apps&apiVersion=v1&kind=Deployment',
    ).set('Accept-Encoding', 'gzip');

    expect(response.status).toBe(200);
    // superagent decodes the body transparently, so the proof that the stored
    // gzip went out untouched is the header plus a payload that decodes cleanly.
    expect(response.headers['content-encoding']).toBe('gzip');
    expect(response.headers.vary).toContain('Accept-Encoding');
    expect(response.headers.etag).toBeDefined();
    expect(response.body).toEqual(definition);
  });

  it('decompresses for a client that will not take gzip', async () => {
    const { store, server } = await startBackend();
    await seed(store);

    const response = await get(
      server,
      '/api/kubespec/v1/resource/schema?source=kubernetes&group=apps&apiVersion=v1&kind=Deployment',
    ).set('Accept-Encoding', 'identity');

    expect(response.status).toBe(200);
    expect(response.headers['content-encoding']).toBeUndefined();
    expect(response.body).toEqual(definition);
  });

  it('answers a matching If-None-Match with 304', async () => {
    const { store, server } = await startBackend();
    await seed(store);

    const path = '/api/kubespec/v1/resource/schema?source=kubernetes&group=apps&apiVersion=v1&kind=Deployment';
    const first = await get(server, path);
    const second = await get(server, path).set('If-None-Match', first.headers.etag);

    expect(second.status).toBe(304);
  });

  it('spells the core group as "core" in the query', async () => {
    const { store, server } = await startBackend();
    await seed(store, [resource({ apiGroup: '', apiVersionFull: 'v1', kind: 'Pod' })]);

    const response = await get(server, '/api/kubespec/v1/resource?source=kubernetes&group=core&apiVersion=v1&kind=Pod');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ group: '', apiVersionFull: 'v1', kind: 'Pod' });
  });

  it('returns 404 for a kind that is not in the version', async () => {
    const { store, server } = await startBackend();
    await seed(store);

    const response = await get(
      server,
      '/api/kubespec/v1/resource?source=kubernetes&group=apps&apiVersion=v1&kind=Nonexistent',
    );

    expect(response.status).toBe(404);
  });

  it('returns 404 for a version that was never ingested', async () => {
    const { store, server } = await startBackend();
    await seed(store);

    const response = await get(server, '/api/kubespec/v1/resources?source=kubernetes&version=v9.99');

    expect(response.status).toBe(404);
    expect(response.body.error.message).toContain('v9.99');
  });

  it('returns the change summary and its change list', async () => {
    const { store, server } = await startBackend();
    await seed(store);

    const summary = await get(
      server,
      '/api/kubespec/v1/changes/summary?source=kubernetes&group=apps&apiVersion=v1&kind=Deployment',
    );
    expect(summary.body.items).toEqual([expect.objectContaining({ version: 'v1.33', addedCount: 1 })]);

    const changes = await get(
      server,
      '/api/kubespec/v1/changes?source=kubernetes&group=apps&apiVersion=v1&kind=Deployment&type=new',
    );
    expect(changes.body.items).toEqual([expect.objectContaining({ path: '.spec.paused' })]);
  });

  it('searches kinds and property paths', async () => {
    const { store, server } = await startBackend();
    await seed(store);

    const response = await get(server, '/api/kubespec/v1/search?q=replicas&source=kubernetes');

    expect(response.status).toBe(200);
    expect(response.body.properties).toEqual([
      expect.objectContaining({ path: '.spec.replicas', kind: 'Deployment', sourceVersion: 'v1.33' }),
    ]);
  });

  it('serves hand-authored metadata', async () => {
    const { store, server } = await startBackend();
    await seed(store);

    const response = await get(
      server,
      '/api/kubespec/v1/metadata?source=kubernetes&apiVersion=apps/v1&kind=Deployment',
    );

    expect(response.status).toBe(200);
    expect(response.body.examples).toHaveLength(2);
    expect(response.body.links).toHaveLength(2);
  });

  it('rejects a malformed cursor with 400', async () => {
    const { store, server } = await startBackend();
    await seed(store);

    const response = await get(server, '/api/kubespec/v1/versions?source=kubernetes&cursor=not-a-cursor');

    expect(response.status).toBe(400);
  });

  it('rejects a too-short search query with 400', async () => {
    const { server } = await startBackend();

    expect((await get(server, '/api/kubespec/v1/search?q=a')).status).toBe(400);
  });

  it('refuses to trigger a sync that is disabled, and says how to enable it', async () => {
    const { server } = await startBackend();

    const response = await request(server)
      .post('/api/kubespec/v1/sync')
      .set('Authorization', mockCredentials.user.header());

    expect(response.status).toBe(404);
    expect(response.body.error.message).toContain('kubespec.sync.enabled');
  });
});

describe('POST /v1/sync?force=true', () => {
  it('marks every source for a rebuild before queueing the task', async () => {
    const requestForceResync = jest.fn(async () => 34);
    const scheduler = { triggerTask: jest.fn(async () => {}) } as unknown as SchedulerService;

    const router = await createRouter({
      httpAuth: mockServices.httpAuth(),
      store: { requestForceResync } as unknown as KubespecStore,
      scheduler,
      config: readKubespecConfig(new ConfigReader({})),
      syncEnabled: true,
    });

    const response = await request(express().use(router))
      .post('/v1/sync?force=true')
      .set('Authorization', mockCredentials.user.header());

    // The flag is stored rather than passed to the scheduler, which carries no
    // parameters of its own.
    expect(requestForceResync).toHaveBeenCalled();
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ triggered: true, force: true });
  });

  it('does not touch the sources for an ordinary sync', async () => {
    const requestForceResync = jest.fn(async () => 0);
    const router = await createRouter({
      httpAuth: mockServices.httpAuth(),
      store: { requestForceResync } as unknown as KubespecStore,
      scheduler: { triggerTask: jest.fn(async () => {}) } as unknown as SchedulerService,
      config: readKubespecConfig(new ConfigReader({})),
      syncEnabled: true,
    });

    await request(express().use(router)).post('/v1/sync').set('Authorization', mockCredentials.user.header());

    expect(requestForceResync).not.toHaveBeenCalled();
  });
});

describe('POST /v1/sync when a sync is already running', () => {
  it('reports it as success rather than passing the conflict on', async () => {
    // The scheduler throws ConflictError when the task is mid-run, and there is
    // no way to force that through startTestBackend — so the router is built
    // directly against a scheduler that does. The raw 409 reached the page as
    // "Request failed with 409 Conflict", which tells a reader nothing.
    const scheduler = {
      triggerTask: jest.fn(async () => {
        throw new ConflictError('Task kubespec-sync is currently running');
      }),
    } as unknown as SchedulerService;

    const router = await createRouter({
      httpAuth: mockServices.httpAuth(),
      store: {} as unknown as KubespecStore,
      scheduler,
      config: readKubespecConfig(new ConfigReader({})),
      syncEnabled: true,
    });

    const app = express().use(router);
    const response = await request(app).post('/v1/sync').set('Authorization', mockCredentials.user.header());

    expect(scheduler.triggerTask).toHaveBeenCalledWith('kubespec-sync');
    expect(response.status).toBe(202);
    expect(response.body).toEqual({ triggered: false, alreadyRunning: true, force: false });
  });
});
