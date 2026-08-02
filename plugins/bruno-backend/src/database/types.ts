import type { BrunoReportResultResult, BrunoReportSummary, BrunoResultStatus } from '@sbordeyne/bruno-report-type';

export interface NewResultDetail {
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  responseHeaders: Record<string, string>;
  /** Already serialized and truncated by the worker. */
  responseBody: string | null;
  responseBodyTruncated: boolean;
  assertionResults: BrunoReportResultResult[];
  testResults: BrunoReportResultResult[];
  preRequestTestResults: BrunoReportResultResult[];
  postResponseTestResults: BrunoReportResultResult[];
}

export interface NewResult {
  id: string;
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
  detail: NewResultDetail;
}

export interface NewRun {
  id: string;
  runKey: string;
  entityRef: string;
  reportName: string;
  /** Which kind of store the artifact came from: `gcs`, `s3` or `github`. */
  sourceType: string;
  /** The container it came from: `gs://bucket`, `s3://bucket`, `github://owner/repo`. */
  artifactSource: string;
  artifactPath: string;
  artifactVersion: string;
  artifactEtag: string | null;
  artifactSizeBytes: number | null;
  artifactCreatedAt: Date;
  iterationCount: number;
  status: 'pass' | 'fail';
  summary: BrunoReportSummary;
}

export interface InsertRunInput {
  run: NewRun;
  results: NewResult[];
}
