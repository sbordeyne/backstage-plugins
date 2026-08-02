import { TestDatabases, mockServices } from '@backstage/backend-test-utils';
import type { BrunoReportSummary } from '@sbordeyne/bruno-report-type';
import fs from 'fs';
import { randomUUID } from 'node:crypto';

import { BrunoStore, migrationsDir } from './BrunoStore';
import { decodeResultCursor, decodeRunCursor } from './cursors';
import type { InsertRunInput, NewResult } from './types';

jest.setTimeout(120_000);

const EMPTY_SUMMARY: BrunoReportSummary = {
  totalRequests: 0,
  passedRequests: 0,
  failedRequests: 0,
  errorRequests: 0,
  skippedRequests: 0,
  totalAssertions: 0,
  passedAssertions: 0,
  failedAssertions: 0,
  totalTests: 0,
  passedTests: 0,
  failedTests: 0,
  totalPreRequestTests: 0,
  passedPreRequestTests: 0,
  failedPreRequestTests: 0,
  totalPostResponseTests: 0,
  passedPostResponseTests: 0,
  failedPostResponseTests: 0,
};

function makeResult(seq: number, overrides: Partial<NewResult> = {}): NewResult {
  return {
    id: randomUUID(),
    seq,
    iterationIndex: 0,
    name: `request ${seq}`,
    path: `/req/${seq}`,
    testFilename: `req-${seq}.bru`,
    status: 'pass',
    requestMethod: 'GET',
    requestUrl: `https://example.test/${seq}`,
    responseStatus: 200,
    responseStatusText: 'OK',
    responseTimeMs: 12,
    runDurationMs: 15,
    error: null,
    assertionsTotal: 1,
    assertionsPassed: 1,
    testsTotal: 1,
    testsPassed: 1,
    detail: {
      requestHeaders: { accept: 'application/json' },
      requestBody: null,
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: JSON.stringify({ seq }),
      responseBodyTruncated: false,
      assertionResults: [],
      testResults: [],
      preRequestTestResults: [],
      postResponseTestResults: [],
    },
    ...overrides,
  };
}

function makeRun(options: {
  entityRef?: string;
  createdAt?: Date;
  results?: NewResult[];
  artifactPath?: string;
  runKey?: string;
}): InsertRunInput {
  const id = randomUUID();
  return {
    run: {
      id,
      runKey: options.runKey ?? randomUUID(),
      entityRef: options.entityRef ?? 'component:default/sample',
      reportName: 'sample.json',
      sourceType: 'gcs',
      artifactSource: 'gs://test-bucket',
      artifactPath: options.artifactPath ?? `ui_tests/reports/bruno/${id}/unit/sample.json`,
      artifactVersion: '1',
      artifactEtag: null,
      artifactSizeBytes: 1024,
      artifactCreatedAt: options.createdAt ?? new Date('2026-07-01T10:00:00.000Z'),
      iterationCount: 1,
      status: 'pass',
      summary: { ...EMPTY_SUMMARY, totalRequests: options.results?.length ?? 0 },
    },
    results: options.results ?? [makeResult(0)],
  };
}

describe('BrunoStore', () => {
  const databases = TestDatabases.create({ ids: ['SQLITE_3', 'POSTGRES_17'] });

  async function createStore(databaseId: Parameters<typeof databases.init>[0]): Promise<BrunoStore> {
    const knex = await databases.init(databaseId);
    return BrunoStore.create({ database: mockServices.database({ knex }) });
  }

  it('ships the migrations directory that production resolves at runtime', () => {
    // package.json `files` must list "migrations", or this exists in dev and CI
    // but not in the built image.
    expect(fs.existsSync(migrationsDir)).toBe(true);
  });

  describe.each(databases.eachSupportedId())('%s', databaseId => {
    it('runs migrations and round-trips a run', async () => {
      const store = await createStore(databaseId);
      const input = makeRun({});

      const { inserted, runId } = await store.insertRun(input);

      expect(inserted).toBe(true);
      const run = await store.getRun(runId);
      expect(run).toMatchObject({
        entityRef: 'component:default/sample',
        reportName: 'sample.json',
        resultsCount: 1,
      });
      // Timestamps must be normalized regardless of driver.
      expect(typeof run!.artifactCreatedAt).toBe('string');
      expect(run!.artifactCreatedAt).toBe('2026-07-01T10:00:00.000Z');
    });

    it('is idempotent on run_key', async () => {
      const store = await createStore(databaseId);
      const first = makeRun({ runKey: 'shared-key' });
      const second = makeRun({ runKey: 'shared-key' });

      await store.insertRun(first);
      const outcome = await store.insertRun(second);

      expect(outcome.inserted).toBe(false);
      const page = await store.listRuns({ entityRef: 'component:default/sample', limit: 10 });
      expect(page.items).toHaveLength(1);
    });

    it('reports which run keys already exist', async () => {
      const store = await createStore(databaseId);
      await store.insertRun(makeRun({ runKey: 'present' }));

      const existing = await store.listExistingRunKeys(['present', 'absent']);

      expect(existing.has('present')).toBe(true);
      expect(existing.has('absent')).toBe(false);
    });

    it('inserts more than 500 results in one run', async () => {
      // SQLite caps a compound-select insert at 500 terms; this is the regression
      // guard for the chunking.
      const store = await createStore(databaseId);
      const results = Array.from({ length: 750 }, (_, index) => makeResult(index));

      const { runId } = await store.insertRun(makeRun({ results }));

      const page = await store.listResults({ runId, limit: 1000 });
      expect(page.items).toHaveLength(750);
      expect(page.totalCount).toBe(750);
    });

    it('cascades deletes down to result details', async () => {
      const store = await createStore(databaseId);
      const { runId } = await store.insertRun(makeRun({ results: [makeResult(0), makeResult(1)] }));

      await store.knex('bruno_runs').where('id', runId).del();

      await expect(store.knex('bruno_run_results').where('run_id', runId)).resolves.toEqual([]);
      await expect(store.knex('bruno_run_result_details').where('run_id', runId)).resolves.toEqual([]);
    });

    it('paginates results by seq without gaps or repeats', async () => {
      const store = await createStore(databaseId);
      const results = Array.from({ length: 5 }, (_, index) => makeResult(index));
      const { runId } = await store.insertRun(makeRun({ results }));

      const first = await store.listResults({ runId, limit: 2 });
      expect(first.items.map(item => item.seq)).toEqual([0, 1]);
      expect(first.nextCursor).toBeDefined();

      const second = await store.listResults({ runId, limit: 2, afterSeq: decodeResultCursor(first.nextCursor!) });
      expect(second.items.map(item => item.seq)).toEqual([2, 3]);

      const third = await store.listResults({ runId, limit: 2, afterSeq: decodeResultCursor(second.nextCursor!) });
      expect(third.items.map(item => item.seq)).toEqual([4]);
      // An exhausted page must not advertise a further one.
      expect(third.nextCursor).toBeUndefined();
    });

    it('filters results by status and counts the filtered total', async () => {
      const store = await createStore(databaseId);
      const results = [makeResult(0), makeResult(1, { status: 'error' }), makeResult(2, { status: 'error' })];
      const { runId } = await store.insertRun(makeRun({ results }));

      const page = await store.listResults({ runId, limit: 10, status: 'error' });

      expect(page.items.map(item => item.seq)).toEqual([1, 2]);
      expect(page.totalCount).toBe(2);
    });

    it('keeps run pagination stable when artifact timestamps tie', async () => {
      const store = await createStore(databaseId);
      const createdAt = new Date('2026-07-01T10:00:00.000Z');
      for (let index = 0; index < 3; index++) {
        await store.insertRun(makeRun({ createdAt }));
      }

      const first = await store.listRuns({ entityRef: 'component:default/sample', limit: 2 });
      const second = await store.listRuns({
        entityRef: 'component:default/sample',
        limit: 2,
        cursor: decodeRunCursor(first.nextCursor!),
      });

      const seen = [...first.items, ...second.items].map(item => item.id);
      expect(seen).toHaveLength(3);
      expect(new Set(seen).size).toBe(3);
    });

    it('returns the newest run first', async () => {
      const store = await createStore(databaseId);
      await store.insertRun(makeRun({ createdAt: new Date('2026-07-01T10:00:00.000Z') }));
      const newer = await store.insertRun(makeRun({ createdAt: new Date('2026-07-02T10:00:00.000Z') }));

      const latest = await store.getLatestRun('component:default/sample');

      expect(latest?.id).toBe(newer.runId);
    });

    it('prunes down to the newest N runs', async () => {
      const store = await createStore(databaseId);
      for (let index = 0; index < 10; index++) {
        await store.insertRun(makeRun({ createdAt: new Date(Date.UTC(2026, 6, index + 1)) }));
      }

      const deleted = await store.pruneRunsForEntity('component:default/sample', 3);

      expect(deleted).toBe(7);
      const remaining = await store.listRuns({ entityRef: 'component:default/sample', limit: 100 });
      expect(remaining.items).toHaveLength(3);
      expect(remaining.items[0].artifactCreatedAt).toBe(new Date(Date.UTC(2026, 6, 10)).toISOString());
    });

    it('treats a retention of -1 as unlimited', async () => {
      const store = await createStore(databaseId);
      for (let index = 0; index < 4; index++) {
        await store.insertRun(makeRun({ createdAt: new Date(Date.UTC(2026, 6, index + 1)) }));
      }

      const deleted = await store.pruneRunsForEntity('component:default/sample', -1);

      expect(deleted).toBe(0);
      const remaining = await store.listRuns({ entityRef: 'component:default/sample', limit: 100 });
      expect(remaining.items).toHaveLength(4);
    });

    it('deletes superseded versions of the same artifact', async () => {
      const store = await createStore(databaseId);
      const artifactPath = 'ui_tests/reports/bruno/run/unit/sample.json';
      await store.insertRun(makeRun({ artifactPath }));
      const kept = await store.insertRun(makeRun({ artifactPath }));

      const deleted = await store.deleteSupersededRuns({
        entityRef: 'component:default/sample',
        artifactSource: 'gs://test-bucket',
        artifactPath,
        keepRunId: kept.runId,
      });

      expect(deleted).toBe(1);
    });

    it('prunes entities that are no longer known, and nothing when none are', async () => {
      const store = await createStore(databaseId);
      await store.insertRun(makeRun({ entityRef: 'component:default/kept' }));
      await store.insertRun(makeRun({ entityRef: 'component:default/gone' }));

      // An empty catalog snapshot must never be read as "delete everything".
      await expect(store.pruneOrphanedEntities([])).resolves.toBe(0);

      const deleted = await store.pruneOrphanedEntities(['component:default/kept']);

      expect(deleted).toBe(1);
      await expect(store.listEntityRefsWithRuns()).resolves.toEqual(['component:default/kept']);
    });

    it('loads heavy detail separately from the list row', async () => {
      const store = await createStore(databaseId);
      const result = makeResult(0, {
        detail: {
          requestHeaders: { accept: 'application/json' },
          requestBody: '{"hello":"world"}',
          responseHeaders: { 'content-type': 'application/json' },
          responseBody: '{"ok":true}',
          responseBodyTruncated: true,
          assertionResults: [
            { uid: 'a1', lhsExpr: 'res.status', rhsExpr: '200', rhsOperand: '200', operator: 'eq', status: 'pass' },
          ],
          testResults: [],
          preRequestTestResults: [],
          postResponseTestResults: [],
        },
      });
      const { runId } = await store.insertRun(makeRun({ results: [result] }));

      const listed = await store.listResults({ runId, limit: 10 });
      expect(listed.items[0]).not.toHaveProperty('response.data');

      const found = await store.getResultDetail(result.id);

      expect(found?.entityRef).toBe('component:default/sample');
      expect(found?.detail.request.data).toBe('{"hello":"world"}');
      expect(found?.detail.response.headers).toEqual({ 'content-type': 'application/json' });
      // Booleans come back as 0/1 on sqlite.
      expect(found?.detail.response.truncated).toBe(true);
      expect(found?.detail.assertionResults).toHaveLength(1);
    });

    it('returns undefined for an unknown result', async () => {
      const store = await createStore(databaseId);
      await expect(store.getResultDetail(randomUUID())).resolves.toBeUndefined();
    });
  });
});
