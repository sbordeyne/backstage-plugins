import { createApiRef } from '@backstage/core-plugin-api';
import type {
  BrunoPage,
  BrunoResultDetail,
  BrunoResultListItem,
  BrunoResultStatus,
  BrunoRunSummary,
} from '@sbordeyne/bruno-report-type';

export interface ListRunsRequest {
  entityRef: string;
  limit?: number;
  cursor?: string;
  signal?: AbortSignal;
}

export interface ListResultsRequest {
  runId: string;
  limit?: number;
  cursor?: string;
  status?: BrunoResultStatus;
  signal?: AbortSignal;
}

export interface BrunoApi {
  listRuns(request: ListRunsRequest): Promise<BrunoPage<BrunoRunSummary>>;
  getRun(request: { runId: string; signal?: AbortSignal }): Promise<BrunoRunSummary>;
  listResults(request: ListResultsRequest): Promise<BrunoPage<BrunoResultListItem>>;
  /** Heavy payload for one result — fetched only when a row is expanded. */
  getResult(request: { resultId: string }): Promise<BrunoResultDetail>;
}

export const brunoApiRef = createApiRef<BrunoApi>({
  id: 'plugin.bruno.service',
});
