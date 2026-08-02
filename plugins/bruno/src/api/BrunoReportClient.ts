import type { DiscoveryApi, FetchApi } from '@backstage/core-plugin-api';
import { ResponseError } from '@backstage/errors';
import type { BrunoPage, BrunoResultDetail, BrunoResultListItem, BrunoRunSummary } from '@sbordeyne/bruno-report-type';

import type { BrunoApi, ListResultsRequest, ListRunsRequest } from './BrunoApi';

/** Details are immutable, so a modest cache makes re-expanding a row free. */
const DETAIL_CACHE_MAX_ENTRIES = 50;

type QueryParams = Record<string, string | number | undefined>;

export class BrunoReportClient implements BrunoApi {
  readonly #detailCache = new Map<string, Promise<BrunoResultDetail>>();

  constructor(private readonly discoveryApi: DiscoveryApi, private readonly fetchApi: FetchApi) {}

  async listRuns(request: ListRunsRequest): Promise<BrunoPage<BrunoRunSummary>> {
    return this.get<BrunoPage<BrunoRunSummary>>(
      '/v1/runs',
      { entityRef: request.entityRef, limit: request.limit, cursor: request.cursor },
      request.signal,
    );
  }

  async getRun(request: { runId: string; signal?: AbortSignal }): Promise<BrunoRunSummary> {
    return this.get<BrunoRunSummary>(`/v1/runs/${encodeURIComponent(request.runId)}`, {}, request.signal);
  }

  async listResults(request: ListResultsRequest): Promise<BrunoPage<BrunoResultListItem>> {
    return this.get<BrunoPage<BrunoResultListItem>>(
      `/v1/runs/${encodeURIComponent(request.runId)}/results`,
      { limit: request.limit, cursor: request.cursor, status: request.status },
      request.signal,
    );
  }

  /**
   * Deliberately takes no AbortSignal: the promise is shared between every caller
   * for the same result, so one of them aborting would break the others.
   */
  async getResult(request: { resultId: string }): Promise<BrunoResultDetail> {
    const cached = this.#detailCache.get(request.resultId);
    if (cached) {
      return cached;
    }

    const pending = this.get<BrunoResultDetail>(
      `/v1/results/${encodeURIComponent(request.resultId)}`,
      {},
      undefined,
    ).catch(error => {
      // Never cache a rejection — the user must be able to retry.
      this.#detailCache.delete(request.resultId);
      throw error;
    });

    if (this.#detailCache.size >= DETAIL_CACHE_MAX_ENTRIES) {
      const oldest = this.#detailCache.keys().next().value;
      if (oldest !== undefined) {
        this.#detailCache.delete(oldest);
      }
    }
    this.#detailCache.set(request.resultId, pending);
    return pending;
  }

  private async get<T>(path: string, params: QueryParams, signal?: AbortSignal): Promise<T> {
    const baseUrl = await this.discoveryApi.getBaseUrl('bruno');
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') {
        query.set(key, String(value));
      }
    }
    const queryString = query.toString();
    const response = await this.fetchApi.fetch(`${baseUrl}${path}${queryString ? `?${queryString}` : ''}`, { signal });

    if (!response.ok) {
      // Carries the backend's name/message/stack through to ResponseErrorPanel.
      throw await ResponseError.fromResponse(response);
    }
    return (await response.json()) as T;
  }
}
