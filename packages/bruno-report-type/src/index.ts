export interface BrunoReportResultTest {
  filename: string;
}

export interface BrunoReportResultRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
  url: string;
  headers: Record<string, string>;
  data?: string | null;
}

export interface BrunoReportResultResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data?: unknown;
  url: string;
  responseTime: number;
}

export interface BrunoReportResultResult {
  uid: string;
  lhsExpr: string;
  rhsExpr: string;
  rhsOperand: string;
  operator: string;
  status: 'pass' | 'error';
}

export interface BrunoReportResult {
  test: BrunoReportResultTest;
  request: BrunoReportResultRequest;
  response: BrunoReportResultResponse;
  error: string | null;
  status: 'pass' | 'error';
  nextRequestName?: string | null;
  assertionResults: BrunoReportResultResult[];
  testResults: BrunoReportResultResult[];
  preRequestTestResults: BrunoReportResultResult[];
  postResponseTestResults: BrunoReportResultResult[];
  shouldStopRunnerExecution: boolean;
  runDuration: number;
  name: string;
  path: string;
  iterationIndex: number;
}

export interface BrunoReportSummary {
  totalRequests: number;
  passedRequests: number;
  failedRequests: number;
  errorRequests: number;
  skippedRequests: number;
  totalAssertions: number;
  passedAssertions: number;
  failedAssertions: number;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  totalPreRequestTests: number;
  passedPreRequestTests: number;
  failedPreRequestTests: number;
  totalPostResponseTests: number;
  passedPostResponseTests: number;
  failedPostResponseTests: number;
}

export interface BrunoReport {
  iterationIndex: number;
  results: BrunoReportResult[];
  summary: BrunoReportSummary;
}

/**
 * The shape actually stored in GCS. Bruno writes one entry per iteration, so
 * the artifact is normally an array; single-iteration runs are sometimes written
 * as a bare object. Readers must handle both.
 */
export type BrunoReportArtifact = BrunoReport | BrunoReport[];

export type BrunoResultStatus = BrunoReportResult['status'];

/** A single synced report artifact, as served by the API. */
export interface BrunoRunSummary {
  id: string;
  entityRef: string;
  reportName: string;
  /** ISO-8601. When the artifact was created in the bucket. */
  artifactCreatedAt: string;
  /** ISO-8601. When the worker last ingested it. */
  syncedAt: string;
  iterationCount: number;
  status: 'pass' | 'fail';
  gcsObject: string;
  resultsCount: number;
  summary: BrunoReportSummary;
}

/**
 * A row in the paginated results list. Deliberately free of headers, bodies and
 * assertion arrays so a page of these stays small — fetch {@link BrunoResultDetail}
 * when the user opens one.
 */
export interface BrunoResultListItem {
  id: string;
  runId: string;
  /** 0-based ordinal across all iterations of the run; also the pagination cursor. */
  seq: number;
  iterationIndex: number;
  name: string | null;
  path: string | null;
  testFilename: string | null;
  status: BrunoResultStatus;
  requestMethod: string | null;
  requestUrl: string | null;
  responseStatus: number | null;
  responseStatusText: string | null;
  responseTimeMs: number | null;
  runDurationMs: number | null;
  error: string | null;
  assertionsTotal: number;
  assertionsPassed: number;
  testsTotal: number;
  testsPassed: number;
}

export interface BrunoResultDetail extends BrunoResultListItem {
  request: {
    headers: Record<string, string>;
    data: string | null;
  };
  response: {
    headers: Record<string, string>;
    data: unknown;
    /** The worker truncates bodies above `bruno.sync.maxStoredBodyBytes`. */
    truncated: boolean;
  };
  assertionResults: BrunoReportResultResult[];
  testResults: BrunoReportResultResult[];
  preRequestTestResults: BrunoReportResultResult[];
  postResponseTestResults: BrunoReportResultResult[];
}

export interface BrunoPage<T> {
  items: T[];
  /** Absent when there is no further page. */
  nextCursor?: string;
  totalCount?: number;
}
