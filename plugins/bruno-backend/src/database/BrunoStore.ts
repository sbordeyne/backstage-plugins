import { DatabaseService, resolvePackagePath, isDatabaseConflictError } from '@backstage/backend-plugin-api';
import type {
  BrunoPage,
  BrunoReportResultResult,
  BrunoReportSummary,
  BrunoResultDetail,
  BrunoResultListItem,
  BrunoResultStatus,
  BrunoRunSummary,
} from '@sbordeyne/bruno-report-type';
import type { Knex } from 'knex';

import { chunkSizeFor, chunked } from './chunking';
import { RunCursor, encodeResultCursor, encodeRunCursor } from './cursors';
import { toIsoString } from './timestamps';
import type { InsertRunInput, NewResult, NewRun } from './types';

export const migrationsDir = resolvePackagePath('@sbordeyne/backstage-plugin-bruno-backend', 'migrations');

const SUMMARY_COLUMNS = [
  'total_requests',
  'passed_requests',
  'failed_requests',
  'error_requests',
  'skipped_requests',
  'total_assertions',
  'passed_assertions',
  'failed_assertions',
  'total_tests',
  'passed_tests',
  'failed_tests',
  'total_pre_request_tests',
  'passed_pre_request_tests',
  'failed_pre_request_tests',
  'total_post_response_tests',
  'passed_post_response_tests',
  'failed_post_response_tests',
] as const;

const RUN_COLUMNS = [
  'id',
  'entity_ref',
  'report_name',
  'gcs_object',
  'artifact_created_at',
  'synced_at',
  'iteration_count',
  'results_count',
  'status',
  ...SUMMARY_COLUMNS,
];

/**
 * Never includes the detail tables — a results page must stay small, which is the
 * whole point of splitting them.
 */
const RESULT_LIST_COLUMNS = [
  'id',
  'run_id',
  'seq',
  'iteration_index',
  'name',
  'path',
  'test_filename',
  'status',
  'request_method',
  'request_url',
  'response_status',
  'response_status_text',
  'response_time_ms',
  'run_duration_ms',
  'error',
  'assertions_total',
  'assertions_passed',
  'tests_total',
  'tests_passed',
];

/** Widest table, used to size insert chunks. */
const RESULT_COLUMN_COUNT = 19;

interface ListRunsOptions {
  entityRef: string;
  limit: number;
  cursor?: RunCursor;
}

interface ListResultsOptions {
  runId: string;
  limit: number;
  afterSeq?: number;
  status?: BrunoResultStatus;
  iterationIndex?: number;
}

export class BrunoStore {
  private constructor(private readonly db: Knex) {}

  static async create(options: { database: DatabaseService }): Promise<BrunoStore> {
    const client = await options.database.getClient();
    if (!options.database.migrations?.skip) {
      await client.migrate.latest({ directory: migrationsDir });
    }
    return new BrunoStore(client);
  }

  // --- sync path ----------------------------------------------------------

  async listExistingRunKeys(runKeys: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    for (const chunk of chunked(runKeys, this.chunkSize(1))) {
      const rows = await this.db('bruno_runs').whereIn('run_key', chunk).select('run_key');
      for (const row of rows) {
        found.add(row.run_key);
      }
    }
    return found;
  }

  /**
   * Inserts a run and all of its results in one transaction, so a run is never
   * visible with only part of its results. Idempotent on `run_key`: a losing
   * replica reports `inserted: false` rather than throwing.
   */
  async insertRun(input: InsertRunInput): Promise<{ inserted: boolean; runId: string }> {
    return this.db.transaction(async trx => {
      try {
        await trx('bruno_runs').insert(toRunRow(input.run, input.results.length));
      } catch (error) {
        if (isDatabaseConflictError(error)) {
          return { inserted: false, runId: input.run.id };
        }
        throw error;
      }

      const resultChunkSize = this.chunkSize(RESULT_COLUMN_COUNT);
      for (const chunk of chunked(input.results, resultChunkSize)) {
        await trx('bruno_run_results').insert(chunk.map(result => toResultRow(input.run.id, result)));
      }
      for (const chunk of chunked(input.results, resultChunkSize)) {
        await trx('bruno_run_result_details').insert(chunk.map(result => toDetailRow(input.run.id, result)));
      }

      return { inserted: true, runId: input.run.id };
    });
  }

  /** Drops older generations of the same object once a newer one is stored. */
  async deleteSupersededRuns(options: {
    entityRef: string;
    gcsBucket: string;
    gcsObject: string;
    keepRunId: string;
  }): Promise<number> {
    return this.db('bruno_runs')
      .where('entity_ref', options.entityRef)
      .andWhere('gcs_bucket', options.gcsBucket)
      .andWhere('gcs_object', options.gcsObject)
      .andWhereNot('id', options.keepRunId)
      .del();
  }

  /** Keeps the newest `keep` runs for an entity. `keep < 0` means unlimited. */
  async pruneRunsForEntity(entityRef: string, keep: number): Promise<number> {
    if (keep < 0) {
      return 0;
    }
    if (keep === 0) {
      return this.db('bruno_runs').where('entity_ref', entityRef).del();
    }

    const doomed = this.db('bruno_runs')
      .select('id')
      .where('entity_ref', entityRef)
      .orderBy([
        { column: 'artifact_created_at', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
      .offset(keep)
      // Postgres accepts OFFSET without LIMIT; SQLite does not. An explicit
      // large limit keeps one statement valid on both.
      .limit(1_000_000);

    return this.db('bruno_runs').whereIn('id', doomed).del();
  }

  /** Removes runs for entities that no longer exist or lost the annotation. */
  async pruneOrphanedEntities(knownEntityRefs: string[]): Promise<number> {
    if (knownEntityRefs.length === 0) {
      return 0;
    }
    const stored = await this.listEntityRefsWithRuns();
    const known = new Set(knownEntityRefs);
    const orphaned = stored.filter(entityRef => !known.has(entityRef));

    let deleted = 0;
    for (const chunk of chunked(orphaned, this.chunkSize(1))) {
      deleted += await this.db('bruno_runs').whereIn('entity_ref', chunk).del();
    }
    return deleted;
  }

  async listEntityRefsWithRuns(): Promise<string[]> {
    const rows = await this.db('bruno_runs').distinct('entity_ref');
    return rows.map(row => row.entity_ref);
  }

  // --- read path ----------------------------------------------------------

  async listRuns(options: ListRunsOptions): Promise<BrunoPage<BrunoRunSummary>> {
    const query = this.db('bruno_runs').where('entity_ref', options.entityRef).select(RUN_COLUMNS);

    if (options.cursor) {
      const { t, id } = options.cursor;
      const at = new Date(t);
      // Tuple comparison spelled out: SQLite has no row-value `(a, b) < (?, ?)`.
      query.where(builder =>
        builder
          .where('artifact_created_at', '<', at)
          .orWhere(tie => tie.where('artifact_created_at', '=', at).andWhere('id', '<', id)),
      );
    }

    const rows = await query
      .orderBy([
        { column: 'artifact_created_at', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
      .limit(options.limit + 1);

    return buildPage(rows, options.limit, toRunSummary, last => encodeRunCursor(toRunCursor(last)));
  }

  async getLatestRun(entityRef: string): Promise<BrunoRunSummary | undefined> {
    const page = await this.listRuns({ entityRef, limit: 1 });
    return page.items[0];
  }

  async getRun(runId: string): Promise<BrunoRunSummary | undefined> {
    const row = await this.db('bruno_runs').where('id', runId).first(RUN_COLUMNS);
    return row ? toRunSummary(row) : undefined;
  }

  async listResults(options: ListResultsOptions): Promise<BrunoPage<BrunoResultListItem>> {
    const query = this.db('bruno_run_results').where('run_id', options.runId).select(RESULT_LIST_COLUMNS);

    if (options.afterSeq !== undefined) {
      query.where('seq', '>', options.afterSeq);
    }
    if (options.status) {
      query.where('status', options.status);
    }
    if (options.iterationIndex !== undefined) {
      query.where('iteration_index', options.iterationIndex);
    }

    const rows = await query.orderBy('seq', 'asc').limit(options.limit + 1);

    const page = buildPage(rows, options.limit, toResultListItem, last => encodeResultCursor(Number(last.seq)));
    page.totalCount = await this.countResults(options);
    return page;
  }

  async getResultDetail(resultId: string): Promise<{ entityRef: string; detail: BrunoResultDetail } | undefined> {
    const row = await this.db('bruno_run_results')
      .join('bruno_run_result_details', 'bruno_run_results.id', 'bruno_run_result_details.result_id')
      .join('bruno_runs', 'bruno_run_results.run_id', 'bruno_runs.id')
      .where('bruno_run_results.id', resultId)
      .first([
        ...RESULT_LIST_COLUMNS.map(column => `bruno_run_results.${column}`),
        'bruno_run_result_details.request_headers_json',
        'bruno_run_result_details.request_body',
        'bruno_run_result_details.response_headers_json',
        'bruno_run_result_details.response_body',
        'bruno_run_result_details.response_body_truncated',
        'bruno_run_result_details.assertion_results_json',
        'bruno_run_result_details.test_results_json',
        'bruno_run_result_details.pre_request_test_results_json',
        'bruno_run_result_details.post_response_test_results_json',
        'bruno_runs.entity_ref',
      ]);

    if (!row) {
      return undefined;
    }
    return { entityRef: row.entity_ref, detail: toResultDetail(row) };
  }

  /** Exposed for the migration smoke test. */
  get knex(): Knex {
    return this.db;
  }

  private async countResults(options: ListResultsOptions): Promise<number> {
    const query = this.db('bruno_run_results').where('run_id', options.runId);
    if (options.status) {
      query.where('status', options.status);
    }
    if (options.iterationIndex !== undefined) {
      query.where('iteration_index', options.iterationIndex);
    }
    const row = await query.count({ count: '*' }).first();
    return Number(row?.count ?? 0);
  }

  private chunkSize(columnCount: number): number {
    return chunkSizeFor(this.db.client.config.client, columnCount);
  }
}

// --- row mapping ----------------------------------------------------------

function buildPage<TRow, TItem>(
  rows: TRow[],
  limit: number,
  toItem: (row: TRow) => TItem,
  toCursor: (row: TRow) => string,
): BrunoPage<TItem> {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: page.map(toItem),
    nextCursor: hasMore ? toCursor(page[page.length - 1]) : undefined,
  };
}

function toRunCursor(row: any): RunCursor {
  return { t: new Date(toIsoString(row.artifact_created_at)).getTime(), id: row.id };
}

function toRunRow(run: NewRun, resultsCount: number): Record<string, unknown> {
  return {
    id: run.id,
    run_key: run.runKey,
    entity_ref: run.entityRef,
    report_name: run.reportName,
    gcs_bucket: run.gcsBucket,
    gcs_object: run.gcsObject,
    gcs_generation: run.gcsGeneration,
    gcs_etag: run.gcsEtag,
    gcs_size_bytes: run.gcsSizeBytes,
    artifact_created_at: run.artifactCreatedAt,
    synced_at: new Date(),
    iteration_count: run.iterationCount,
    results_count: resultsCount,
    status: run.status,
    ...toSummaryRow(run.summary),
  };
}

function toSummaryRow(summary: BrunoReportSummary): Record<string, number> {
  return {
    total_requests: summary.totalRequests,
    passed_requests: summary.passedRequests,
    failed_requests: summary.failedRequests,
    error_requests: summary.errorRequests,
    skipped_requests: summary.skippedRequests,
    total_assertions: summary.totalAssertions,
    passed_assertions: summary.passedAssertions,
    failed_assertions: summary.failedAssertions,
    total_tests: summary.totalTests,
    passed_tests: summary.passedTests,
    failed_tests: summary.failedTests,
    total_pre_request_tests: summary.totalPreRequestTests,
    passed_pre_request_tests: summary.passedPreRequestTests,
    failed_pre_request_tests: summary.failedPreRequestTests,
    total_post_response_tests: summary.totalPostResponseTests,
    passed_post_response_tests: summary.passedPostResponseTests,
    failed_post_response_tests: summary.failedPostResponseTests,
  };
}

function toSummary(row: any): BrunoReportSummary {
  return {
    totalRequests: Number(row.total_requests),
    passedRequests: Number(row.passed_requests),
    failedRequests: Number(row.failed_requests),
    errorRequests: Number(row.error_requests),
    skippedRequests: Number(row.skipped_requests),
    totalAssertions: Number(row.total_assertions),
    passedAssertions: Number(row.passed_assertions),
    failedAssertions: Number(row.failed_assertions),
    totalTests: Number(row.total_tests),
    passedTests: Number(row.passed_tests),
    failedTests: Number(row.failed_tests),
    totalPreRequestTests: Number(row.total_pre_request_tests),
    passedPreRequestTests: Number(row.passed_pre_request_tests),
    failedPreRequestTests: Number(row.failed_pre_request_tests),
    totalPostResponseTests: Number(row.total_post_response_tests),
    passedPostResponseTests: Number(row.passed_post_response_tests),
    failedPostResponseTests: Number(row.failed_post_response_tests),
  };
}

function toRunSummary(row: any): BrunoRunSummary {
  return {
    id: row.id,
    entityRef: row.entity_ref,
    reportName: row.report_name,
    artifactCreatedAt: toIsoString(row.artifact_created_at),
    syncedAt: toIsoString(row.synced_at),
    iterationCount: Number(row.iteration_count),
    resultsCount: Number(row.results_count),
    status: row.status,
    gcsObject: row.gcs_object,
    summary: toSummary(row),
  };
}

function toResultRow(runId: string, result: NewResult): Record<string, unknown> {
  return {
    id: result.id,
    run_id: runId,
    seq: result.seq,
    iteration_index: result.iterationIndex,
    name: result.name,
    path: result.path,
    test_filename: result.testFilename,
    status: result.status,
    request_method: result.requestMethod,
    request_url: result.requestUrl,
    response_status: result.responseStatus,
    response_status_text: result.responseStatusText,
    response_time_ms: result.responseTimeMs,
    run_duration_ms: result.runDurationMs,
    error: result.error,
    assertions_total: result.assertionsTotal,
    assertions_passed: result.assertionsPassed,
    tests_total: result.testsTotal,
    tests_passed: result.testsPassed,
  };
}

function toDetailRow(runId: string, result: NewResult): Record<string, unknown> {
  const detail = result.detail;
  return {
    result_id: result.id,
    run_id: runId,
    request_headers_json: JSON.stringify(detail.requestHeaders ?? {}),
    request_body: detail.requestBody,
    response_headers_json: JSON.stringify(detail.responseHeaders ?? {}),
    response_body: detail.responseBody,
    response_body_truncated: detail.responseBodyTruncated,
    assertion_results_json: JSON.stringify(detail.assertionResults ?? []),
    test_results_json: JSON.stringify(detail.testResults ?? []),
    pre_request_test_results_json: JSON.stringify(detail.preRequestTestResults ?? []),
    post_response_test_results_json: JSON.stringify(detail.postResponseTestResults ?? []),
  };
}

function toResultListItem(row: any): BrunoResultListItem {
  return {
    id: row.id,
    runId: row.run_id,
    seq: Number(row.seq),
    iterationIndex: Number(row.iteration_index),
    name: row.name,
    path: row.path,
    testFilename: row.test_filename,
    status: row.status,
    requestMethod: row.request_method,
    requestUrl: row.request_url,
    responseStatus: nullableNumber(row.response_status),
    responseStatusText: row.response_status_text,
    responseTimeMs: nullableNumber(row.response_time_ms),
    runDurationMs: nullableNumber(row.run_duration_ms),
    error: row.error,
    assertionsTotal: Number(row.assertions_total),
    assertionsPassed: Number(row.assertions_passed),
    testsTotal: Number(row.tests_total),
    testsPassed: Number(row.tests_passed),
  };
}

function toResultDetail(row: any): BrunoResultDetail {
  return {
    ...toResultListItem(row),
    request: {
      headers: parseJson<Record<string, string>>(row.request_headers_json, {}),
      data: row.request_body ?? null,
    },
    response: {
      headers: parseJson<Record<string, string>>(row.response_headers_json, {}),
      data: row.response_body ?? null,
      // SQLite stores booleans as 0/1.
      truncated: Boolean(row.response_body_truncated),
    },
    assertionResults: parseJson<BrunoReportResultResult[]>(row.assertion_results_json, []),
    testResults: parseJson<BrunoReportResultResult[]>(row.test_results_json, []),
    preRequestTestResults: parseJson<BrunoReportResultResult[]>(row.pre_request_test_results_json, []),
    postResponseTestResults: parseJson<BrunoReportResultResult[]>(row.post_response_test_results_json, []),
  };
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
