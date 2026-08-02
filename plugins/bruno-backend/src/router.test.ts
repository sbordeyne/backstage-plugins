import { TestDatabases, mockCredentials, mockServices, startTestBackend } from '@backstage/backend-test-utils';
import type { Entity } from '@backstage/catalog-model';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';
import type { BrunoReportSummary } from '@sbordeyne/bruno-report-type';
import express from 'express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { BrunoStore } from './database/BrunoStore';
import type { InsertRunInput, NewResult } from './database/types';
import { brunoPlugin } from './plugin';

jest.setTimeout(120_000);

const ENTITY_REF = 'component:default/sample';

const sampleEntity: Entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name: 'sample', namespace: 'default', annotations: { 'usebruno.com/report-path': 'sample.json' } },
};

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

function makeResult(seq: number): NewResult {
  return {
    id: randomUUID(),
    seq,
    iterationIndex: 0,
    name: `request ${seq}`,
    path: `/req/${seq}`,
    testFilename: `req-${seq}.bru`,
    status: seq % 2 === 0 ? 'pass' : 'error',
    requestMethod: 'GET',
    requestUrl: `https://example.test/${seq}`,
    responseStatus: 200,
    responseStatusText: 'OK',
    responseTimeMs: 4,
    runDurationMs: 5,
    error: null,
    assertionsTotal: 0,
    assertionsPassed: 0,
    testsTotal: 0,
    testsPassed: 0,
    detail: {
      requestHeaders: {},
      requestBody: null,
      responseHeaders: { 'content-type': 'application/json' },
      responseBody: JSON.stringify({ seq }),
      responseBodyTruncated: false,
      assertionResults: [],
      testResults: [],
      preRequestTestResults: [],
      postResponseTestResults: [],
    },
  };
}

function makeRun(entityRef: string, results: NewResult[]): InsertRunInput {
  const id = randomUUID();
  return {
    run: {
      id,
      runKey: randomUUID(),
      entityRef,
      reportName: 'sample.json',
      sourceType: 'gcs',
      artifactSource: 'gs://test-bucket',
      artifactPath: `ui_tests/reports/bruno/${id}/unit/sample.json`,
      artifactVersion: '1',
      artifactEtag: null,
      artifactSizeBytes: 10,
      artifactCreatedAt: new Date('2026-07-01T10:00:00.000Z'),
      iterationCount: 1,
      status: 'pass',
      summary: EMPTY_SUMMARY,
    },
    results,
  };
}

describe('bruno router', () => {
  const databases = TestDatabases.create({ ids: ['SQLITE_3'] });

  async function startBackend(entities: Entity[] = [sampleEntity], syncEnabled = false) {
    const knex = await databases.init('SQLITE_3');
    const backend = await startTestBackend({
      features: [
        brunoPlugin,
        mockServices.database.factory({ knex }),
        // Keeps the GCS worker out of the test unless a case needs it.
        mockServices.rootConfig.factory({ data: { bruno: { sync: { enabled: syncEnabled } } } }),
        catalogServiceMock.factory({ entities }),
      ],
    });
    const store = await BrunoStore.create({ database: mockServices.database({ knex }) });
    return { backend, store, server: backend.server as unknown as express.Express };
  }

  function get(server: express.Express, path: string) {
    return request(server).get(path).set('Authorization', mockCredentials.user.header());
  }

  it('lists runs for a visible entity', async () => {
    const { server, store } = await startBackend();
    await store.insertRun(makeRun(ENTITY_REF, [makeResult(0)]));

    const response = await get(server, `/api/bruno/v1/runs?entityRef=${encodeURIComponent(ENTITY_REF)}`);

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({ entityRef: ENTITY_REF, reportName: 'sample.json' });
  });

  it('rejects a request without an entityRef', async () => {
    const { server } = await startBackend();

    const response = await get(server, '/api/bruno/v1/runs');

    expect(response.status).toBe(400);
  });

  it('rejects a malformed cursor', async () => {
    const { server } = await startBackend();

    const response = await get(server, `/api/bruno/v1/runs?entityRef=${encodeURIComponent(ENTITY_REF)}&cursor=nope`);

    expect(response.status).toBe(400);
  });

  it('404s when the catalog does not return the entity', async () => {
    const { server, store } = await startBackend([]);
    await store.insertRun(makeRun(ENTITY_REF, [makeResult(0)]));

    const response = await get(server, `/api/bruno/v1/runs?entityRef=${encodeURIComponent(ENTITY_REF)}`);

    expect(response.status).toBe(404);
  });

  it('paginates results into disjoint pages', async () => {
    const { server, store } = await startBackend();
    const results = Array.from({ length: 5 }, (_, index) => makeResult(index));
    const { runId } = await store.insertRun(makeRun(ENTITY_REF, results));

    const first = await get(server, `/api/bruno/v1/runs/${runId}/results?limit=2`);
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(2);
    expect(first.body.totalCount).toBe(5);

    const second = await get(server, `/api/bruno/v1/runs/${runId}/results?limit=2&cursor=${first.body.nextCursor}`);

    const seqs = [...first.body.items, ...second.body.items].map((item: { seq: number }) => item.seq);
    expect(seqs).toEqual([0, 1, 2, 3]);
  });

  it('filters results by status', async () => {
    const { server, store } = await startBackend();
    const results = Array.from({ length: 4 }, (_, index) => makeResult(index));
    const { runId } = await store.insertRun(makeRun(ENTITY_REF, results));

    const response = await get(server, `/api/bruno/v1/runs/${runId}/results?status=error`);

    expect(response.body.items.map((item: { seq: number }) => item.seq)).toEqual([1, 3]);
    expect(response.body.totalCount).toBe(2);
  });

  it('omits heavy payloads from the results list but serves them on the detail route', async () => {
    const { server, store } = await startBackend();
    const result = makeResult(0);
    const { runId } = await store.insertRun(makeRun(ENTITY_REF, [result]));

    const list = await get(server, `/api/bruno/v1/runs/${runId}/results`);
    expect(list.body.items[0].response).toBeUndefined();

    const detail = await get(server, `/api/bruno/v1/results/${result.id}`);

    expect(detail.status).toBe(200);
    expect(detail.body.response.headers).toEqual({ 'content-type': 'application/json' });
    expect(detail.headers['cache-control']).toContain('immutable');
  });

  it('404s a detail request whose owning entity is invisible', async () => {
    const { server, store } = await startBackend([]);
    const result = makeResult(0);
    await store.insertRun(makeRun(ENTITY_REF, [result]));

    const response = await get(server, `/api/bruno/v1/results/${result.id}`);

    expect(response.status).toBe(404);
  });

  it('404s an unknown run', async () => {
    const { server } = await startBackend();

    const response = await get(server, `/api/bruno/v1/runs/${randomUUID()}/results`);

    expect(response.status).toBe(404);
  });

  it('explains that a manual sync is unavailable while sync is disabled', async () => {
    const { server } = await startBackend();

    const response = await request(server)
      .post('/api/bruno/v1/sync')
      .set('Authorization', mockCredentials.user.header());

    expect(response.status).toBe(404);
    expect(response.body.error.message).toMatch(/bruno\.sync\.enabled/);
  });

  it('rejects unauthenticated requests', async () => {
    const { server } = await startBackend();

    // The mock httpAuth treats a header-less request as the default user, so an
    // unauthenticated caller has to be spelled out.
    const response = await request(server)
      .get(`/api/bruno/v1/runs?entityRef=${encodeURIComponent(ENTITY_REF)}`)
      .set('Authorization', mockCredentials.none.header());

    expect(response.status).toBe(401);
  });
});
