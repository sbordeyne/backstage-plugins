import { mockServices } from '@backstage/backend-test-utils';
import type { Entity } from '@backstage/catalog-model';
import type { catalogServiceRef } from '@backstage/plugin-catalog-node';

import type { BrunoConfig } from '../config';
import type { BrunoStore } from '../database/BrunoStore';
import type { BrunoArtifactRef, BrunoArtifactSource, BrunoSourceType } from '../sources';
import { BrunoSyncWorker } from './BrunoSyncWorker';

const PREFIX = 'ui_tests/reports/bruno/';

function artifact(overrides: Partial<BrunoArtifactRef> & { name: string }): BrunoArtifactRef {
  return {
    source: 'gs://test-bucket',
    version: '1',
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    sizeBytes: 512,
    ...overrides,
  };
}

function reportBody(requestCount = 1): Buffer {
  return Buffer.from(
    JSON.stringify([
      {
        iterationIndex: 0,
        results: Array.from({ length: requestCount }, (_, index) => ({
          test: { filename: `req-${index}.bru` },
          request: { method: 'GET', url: `https://example.test/${index}`, headers: {}, data: null },
          response: { status: 200, statusText: 'OK', headers: {}, data: { ok: true }, url: '', responseTime: 5 },
          error: null,
          status: 'pass',
          assertionResults: [],
          testResults: [],
          preRequestTestResults: [],
          postResponseTestResults: [],
          runDuration: 6,
          name: `req ${index}`,
          path: `/req/${index}`,
          iterationIndex: 0,
        })),
        summary: { totalRequests: requestCount, passedRequests: requestCount },
      },
    ]),
  );
}

class FakeArtifactSource implements BrunoArtifactSource {
  readonly type: BrunoSourceType = 'gcs';
  readonly downloads: string[] = [];

  constructor(private readonly objects: Map<string, { ref: BrunoArtifactRef; body: Buffer | Error }>) {}

  async *list(): AsyncIterable<BrunoArtifactRef> {
    for (const { ref } of this.objects.values()) {
      yield ref;
    }
  }

  async download(ref: BrunoArtifactRef): Promise<Buffer> {
    this.downloads.push(ref.name);
    const entry = this.objects.get(ref.name);
    if (!entry || entry.body instanceof Error) {
      throw entry?.body ?? new Error(`missing ${ref.name}`);
    }
    return entry.body;
  }
}

function makeSource(entries: Array<{ ref: BrunoArtifactRef; body?: Buffer | Error }>): FakeArtifactSource {
  return new FakeArtifactSource(
    new Map(entries.map(entry => [entry.ref.name, { ref: entry.ref, body: entry.body ?? reportBody() }])),
  );
}

function makeCatalog(entities: Entity[]): typeof catalogServiceRef.T {
  return {
    getEntities: jest.fn().mockResolvedValue({ items: entities }),
  } as unknown as typeof catalogServiceRef.T;
}

function annotatedEntity(name: string, reportName: string): Entity {
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: { name, namespace: 'default', annotations: { 'usebruno.com/report-path': reportName } },
  };
}

function makeStore(overrides: Partial<Record<keyof BrunoStore, unknown>> = {}) {
  return {
    listExistingRunKeys: jest.fn().mockResolvedValue(new Set<string>()),
    insertRun: jest.fn().mockResolvedValue({ inserted: true, runId: 'run-1' }),
    deleteSupersededRuns: jest.fn().mockResolvedValue(0),
    pruneRunsForEntity: jest.fn().mockResolvedValue(0),
    pruneOrphanedEntities: jest.fn().mockResolvedValue(0),
    listEntityRefsWithRuns: jest.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as jest.Mocked<BrunoStore>;
}

function makeConfig(overrides: Partial<BrunoConfig> = {}): BrunoConfig {
  return {
    source: { type: 'gcs', bucket: 'test-bucket', prefix: PREFIX, requiredPathSegment: 'unit' },
    reportAnnotation: 'usebruno.com/report-path',
    retention: { runsPerEntity: 20 },
    sync: {
      enabled: true,
      concurrency: 2,
      maxObjectSizeBytes: 1024 * 1024,
      maxStoredBodyBytes: 1024,
      schedule: { frequency: { minutes: 15 }, timeout: { minutes: 10 } },
    },
    ...overrides,
  };
}

function makeWorker(options: {
  store?: ReturnType<typeof makeStore>;
  source: BrunoArtifactSource;
  entities?: Entity[];
  config?: BrunoConfig;
  catalog?: typeof catalogServiceRef.T;
}) {
  const store = options.store ?? makeStore();
  const logger = mockServices.logger.mock();
  const worker = new BrunoSyncWorker({
    store,
    source: options.source,
    catalog: options.catalog ?? makeCatalog(options.entities ?? [annotatedEntity('sample', 'sample.json')]),
    auth: mockServices.auth(),
    logger,
    config: options.config ?? makeConfig(),
  });
  return { worker, store, logger };
}

function loggedMessages(logger: ReturnType<typeof mockServices.logger.mock>, level: 'info' | 'warn' | 'error'): string {
  return (logger[level] as jest.Mock).mock.calls.map(call => String(call[0])).join('\n');
}

describe('BrunoSyncWorker', () => {
  it('downloads and stores artifacts owned by an annotated entity', async () => {
    const source = makeSource([{ ref: artifact({ name: `${PREFIX}2026-07-01/unit/sample.json` }) }]);
    const { worker, store } = makeWorker({ source });

    const stats = await worker.syncOnce();

    expect(stats.inserted).toBe(1);
    expect(source.downloads).toEqual([`${PREFIX}2026-07-01/unit/sample.json`]);
    expect(store.insertRun).toHaveBeenCalledWith(
      expect.objectContaining({
        run: expect.objectContaining({ entityRef: 'component:default/sample', reportName: 'sample.json' }),
      }),
    );
  });

  it('ignores artifacts no entity claims', async () => {
    const source = makeSource([{ ref: artifact({ name: `${PREFIX}2026-07-01/unit/unknown.json` }) }]);
    const { worker, store } = makeWorker({ source });

    const stats = await worker.syncOnce();

    expect(source.downloads).toEqual([]);
    expect(store.insertRun).not.toHaveBeenCalled();
    expect(stats.unmatched).toBe(1);
  });

  it('matches on the last path segment alone, whatever the source puts in front of it', async () => {
    // A GitHub artifact is a bare name; an object is a path. Both claim the
    // same report, because only the last segment identifies it.
    const source = makeSource([{ ref: artifact({ name: 'sample.json' }) }]);
    const { worker, store } = makeWorker({ source });

    const stats = await worker.syncOnce();

    expect(stats.inserted).toBe(1);
    expect(store.insertRun).toHaveBeenCalledWith(
      expect.objectContaining({
        run: expect.objectContaining({ reportName: 'sample.json', artifactPath: 'sample.json' }),
      }),
    );
  });

  it('does not re-download an artifact whose version is unchanged', async () => {
    const source = makeSource([{ ref: artifact({ name: `${PREFIX}a/unit/sample.json` }) }]);
    const store = makeStore();
    const { worker } = makeWorker({ source, store });

    await worker.syncOnce();
    const firstKey = (store.listExistingRunKeys as jest.Mock).mock.calls[0][0][0];
    (store.listExistingRunKeys as jest.Mock).mockResolvedValue(new Set([firstKey]));
    await worker.syncOnce();

    expect(source.downloads).toHaveLength(1);
  });

  it('re-downloads and supersedes when the version changes', async () => {
    const source = makeSource([{ ref: artifact({ name: `${PREFIX}a/unit/sample.json`, version: '2' }) }]);
    const { worker, store } = makeWorker({ source });

    await worker.syncOnce();

    expect(source.downloads).toHaveLength(1);
    expect(store.deleteSupersededRuns).toHaveBeenCalledWith(
      expect.objectContaining({ artifactPath: `${PREFIX}a/unit/sample.json` }),
    );
  });

  it('isolates a failing artifact from the rest of the tick', async () => {
    const source = makeSource([
      { ref: artifact({ name: `${PREFIX}a/unit/sample.json` }), body: new Error('boom') },
      { ref: artifact({ name: `${PREFIX}b/unit/other.json` }) },
    ]);
    const { worker, store } = makeWorker({
      source,
      entities: [annotatedEntity('sample', 'sample.json'), annotatedEntity('other', 'other.json')],
    });

    const stats = await worker.syncOnce();

    expect(stats.failed).toBe(1);
    expect(stats.inserted).toBe(1);
    expect(store.insertRun).toHaveBeenCalledTimes(1);
  });

  it('caps downloads to the retention limit before fetching anything', async () => {
    const source = makeSource(
      Array.from({ length: 5 }, (_, index) => ({
        ref: artifact({
          name: `${PREFIX}run-${index}/unit/sample.json`,
          createdAt: new Date(Date.UTC(2026, 6, index + 1)),
        }),
      })),
    );
    const { worker } = makeWorker({ source, config: makeConfig({ retention: { runsPerEntity: 2 } }) });

    await worker.syncOnce();

    expect(source.downloads).toHaveLength(2);
    // The two newest, not just the first two listed.
    expect(source.downloads).toEqual(
      expect.arrayContaining([`${PREFIX}run-4/unit/sample.json`, `${PREFIX}run-3/unit/sample.json`]),
    );
  });

  it('skips artifacts older than the configured age', async () => {
    const source = makeSource([
      { ref: artifact({ name: `${PREFIX}old/unit/sample.json`, createdAt: new Date('2000-01-01T00:00:00.000Z') }) },
    ]);
    const config = makeConfig();
    config.sync.maxArtifactAgeMs = 24 * 60 * 60 * 1000;
    const { worker } = makeWorker({ source, config });

    const stats = await worker.syncOnce();

    expect(stats.skippedTooOld).toBe(1);
    expect(source.downloads).toEqual([]);
  });

  it('skips artifacts above the size limit', async () => {
    const source = makeSource([{ ref: artifact({ name: `${PREFIX}big/unit/sample.json`, sizeBytes: 99_000_000 }) }]);
    const { worker } = makeWorker({ source });

    const stats = await worker.syncOnce();

    expect(stats.skippedTooLarge).toBe(1);
    expect(source.downloads).toEqual([]);
  });

  it('deletes nothing when the catalog returns no annotated entities', async () => {
    const source = makeSource([{ ref: artifact({ name: `${PREFIX}a/unit/sample.json` }) }]);
    const { worker, store } = makeWorker({ source, entities: [] });

    await worker.syncOnce();

    expect(store.pruneOrphanedEntities).not.toHaveBeenCalled();
    expect(store.pruneRunsForEntity).not.toHaveBeenCalled();
    expect(source.downloads).toEqual([]);
  });

  it('stops listing once aborted', async () => {
    const source = makeSource(
      Array.from({ length: 3 }, (_, index) => ({ ref: artifact({ name: `${PREFIX}r${index}/unit/sample.json` }) })),
    );
    const controller = new AbortController();
    controller.abort();
    const { worker } = makeWorker({ source });

    const stats = await worker.syncOnce(controller.signal);

    expect(source.downloads).toEqual([]);
    expect(stats.inserted).toBe(0);
  });

  it('never prunes when retention is unlimited', async () => {
    const source = makeSource([{ ref: artifact({ name: `${PREFIX}a/unit/sample.json` }) }]);
    const { worker, store } = makeWorker({ source, config: makeConfig({ retention: { runsPerEntity: -1 } }) });

    await worker.syncOnce();

    expect(store.pruneRunsForEntity).not.toHaveBeenCalled();
  });

  it('logs that it started before doing any I/O', async () => {
    // Without this line a stalled tick is indistinguishable from one that never ran.
    const source = makeSource([{ ref: artifact({ name: `${PREFIX}a/unit/sample.json` }) }]);
    const { worker, logger } = makeWorker({ source });

    await worker.syncOnce();

    expect(loggedMessages(logger, 'info')).toMatch(/Bruno sync starting/);
  });

  it('names the annotation when no entity carries it', async () => {
    const source = makeSource([{ ref: artifact({ name: `${PREFIX}a/unit/sample.json` }) }]);
    const { worker, logger } = makeWorker({ source, entities: [] });

    await worker.syncOnce();

    expect(loggedMessages(logger, 'warn')).toMatch(/usebruno\.com\/report-path/);
  });

  it('fails loudly instead of hanging when the catalog never responds', async () => {
    const source = makeSource([{ ref: artifact({ name: `${PREFIX}a/unit/sample.json` }) }]);
    const hangingCatalog = {
      getEntities: jest.fn().mockReturnValue(new Promise(() => {})),
    } as unknown as typeof catalogServiceRef.T;
    const controller = new AbortController();
    const { worker } = makeWorker({ source, catalog: hangingCatalog });

    const pending = worker.syncOnce(controller.signal);
    await new Promise(resolve => setTimeout(resolve, 10));
    controller.abort();

    // The scheduler's timeout must actually end the tick; otherwise the task
    // keeps its claim forever and never logs again.
    await expect(pending).rejects.toThrow(/timed out trying to resolve report owners/);
  });

  it('fails loudly instead of hanging when storage never responds', async () => {
    const hangingSource: BrunoArtifactSource = {
      type: 'gcs',
      // eslint-disable-next-line require-yield
      async *list() {
        await new Promise(() => {});
      },
      download: jest.fn(),
    };
    const controller = new AbortController();
    const { worker } = makeWorker({ source: hangingSource });

    const pending = worker.syncOnce(controller.signal);
    // Let the catalog step settle first, so the abort lands during listing.
    await new Promise(resolve => setTimeout(resolve, 10));
    controller.abort();

    await expect(pending).rejects.toThrow(/timed out trying to list storage objects/);
  });

  it('truncates oversized response bodies', async () => {
    const huge = 'x'.repeat(5000);
    const body = Buffer.from(
      JSON.stringify([
        {
          iterationIndex: 0,
          results: [
            {
              test: { filename: 'a.bru' },
              request: { method: 'GET', url: 'https://example.test', headers: {}, data: null },
              response: { status: 200, statusText: 'OK', headers: {}, data: huge, url: '', responseTime: 1 },
              error: null,
              status: 'pass',
              assertionResults: [],
              testResults: [],
              preRequestTestResults: [],
              postResponseTestResults: [],
              runDuration: 1,
              name: 'a',
              path: '/a',
              iterationIndex: 0,
            },
          ],
          summary: { totalRequests: 1, passedRequests: 1 },
        },
      ]),
    );
    const source = makeSource([{ ref: artifact({ name: `${PREFIX}a/unit/sample.json` }), body }]);
    const { worker, store } = makeWorker({ source });

    await worker.syncOnce();

    const input = (store.insertRun as jest.Mock).mock.calls[0][0];
    expect(input.results[0].detail.responseBody).toHaveLength(1024);
    expect(input.results[0].detail.responseBodyTruncated).toBe(true);
  });
});
