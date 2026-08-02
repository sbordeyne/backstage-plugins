import type { DiscoveryApi, FetchApi } from '@backstage/core-plugin-api';
import { ResponseError } from '@backstage/errors';

import { BrunoReportClient } from './BrunoReportClient';

const BASE_URL = 'http://localhost:7007/api/bruno';

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}

function errorResponse(status: number, body: unknown): Response {
  return {
    ok: false,
    status,
    statusText: 'Not Found',
    url: `${BASE_URL}/v1/runs`,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

function createClient(fetchMock: jest.Mock) {
  const discoveryApi: DiscoveryApi = { getBaseUrl: async () => BASE_URL };
  const fetchApi = { fetch: fetchMock } as unknown as FetchApi;
  return new BrunoReportClient(discoveryApi, fetchApi);
}

describe('BrunoReportClient', () => {
  it('requests runs with the entity ref as a query param', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ items: [] }));
    const client = createClient(fetchMock);

    await client.listRuns({ entityRef: 'component:default/sample', limit: 30 });

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/v1/runs?entityRef=component%3Adefault%2Fsample&limit=30`,
      expect.anything(),
    );
  });

  it('omits undefined query params so the backend applies its own defaults', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ items: [] }));
    const client = createClient(fetchMock);

    await client.listResults({ runId: 'run-1' });

    expect(fetchMock).toHaveBeenCalledWith(`${BASE_URL}/v1/runs/run-1/results`, expect.anything());
  });

  it('passes the status filter and cursor through', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ items: [] }));
    const client = createClient(fetchMock);

    await client.listResults({ runId: 'run-1', limit: 25, cursor: '10', status: 'error' });

    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/v1/runs/run-1/results?limit=25&cursor=10&status=error`,
      expect.anything(),
    );
  });

  it('throws a ResponseError carrying the backend message', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(errorResponse(404, { error: { name: 'NotFoundError', message: 'no such entity' } }));
    const client = createClient(fetchMock);

    const failure = await client.listRuns({ entityRef: 'component:default/missing' }).catch(error => error);

    // What matters here is that the failure reaches ResponseErrorPanel as a
    // ResponseError with the status intact; rendering the backend's own message
    // out of the body is @backstage/errors' contract, not this client's.
    expect(failure).toBeInstanceOf(ResponseError);
    expect(failure.statusCode).toBe(404);
    expect(String(failure.cause)).toContain('no such entity');
  });

  it('fetches a result detail once for concurrent callers', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ id: 'result-1' }));
    const client = createClient(fetchMock);

    const [first, second] = await Promise.all([
      client.getResult({ resultId: 'result-1' }),
      client.getResult({ resultId: 'result-1' }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it('serves a repeat detail request from cache', async () => {
    const fetchMock = jest.fn().mockResolvedValue(jsonResponse({ id: 'result-1' }));
    const client = createClient(fetchMock);

    await client.getResult({ resultId: 'result-1' });
    await client.getResult({ resultId: 'result-1' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed detail request', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(errorResponse(500, { error: { name: 'Error', message: 'boom' } }))
      .mockResolvedValueOnce(jsonResponse({ id: 'result-1' }));
    const client = createClient(fetchMock);

    await expect(client.getResult({ resultId: 'result-1' })).rejects.toThrow();
    await expect(client.getResult({ resultId: 'result-1' })).resolves.toEqual({ id: 'result-1' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
