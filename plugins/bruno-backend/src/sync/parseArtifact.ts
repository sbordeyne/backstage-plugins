import type { BrunoReport, BrunoReportSummary } from '@sbordeyne/bruno-report-type';
import { z } from 'zod';

/**
 * Every leaf carries a fallback so a schema change on the Bruno side degrades a
 * single field rather than failing the whole sync tick.
 */
const resultEntrySchema = z
  .object({
    uid: z.string().catch(''),
    lhsExpr: z.string().catch(''),
    rhsExpr: z.string().catch(''),
    rhsOperand: z.string().catch(''),
    operator: z.string().catch(''),
    status: z.enum(['pass', 'error']).catch('error'),
  })
  .passthrough();

const resultSchema = z
  .object({
    test: z
      .object({ filename: z.string().catch('') })
      .passthrough()
      .catch({ filename: '' }),
    request: z
      .object({
        method: z.string().catch('GET'),
        url: z.string().catch(''),
        headers: z.record(z.string()).catch({}),
        data: z.union([z.string(), z.null()]).catch(null),
      })
      .passthrough()
      .catch({ method: 'GET', url: '', headers: {}, data: null }),
    response: z
      .object({
        status: z.number().catch(0),
        statusText: z.string().catch(''),
        headers: z.record(z.string()).catch({}),
        data: z.unknown().catch(null),
        url: z.string().catch(''),
        responseTime: z.number().catch(0),
      })
      .passthrough()
      .catch({ status: 0, statusText: '', headers: {}, data: null, url: '', responseTime: 0 }),
    error: z.union([z.string(), z.null()]).catch(null),
    status: z.enum(['pass', 'error']).catch('error'),
    nextRequestName: z.union([z.string(), z.null()]).catch(null),
    shouldStopRunnerExecution: z.boolean().catch(false),
    assertionResults: z.array(resultEntrySchema).catch([]),
    testResults: z.array(resultEntrySchema).catch([]),
    preRequestTestResults: z.array(resultEntrySchema).catch([]),
    postResponseTestResults: z.array(resultEntrySchema).catch([]),
    runDuration: z.number().catch(0),
    name: z.string().catch(''),
    path: z.string().catch(''),
    iterationIndex: z.number().catch(0),
  })
  .passthrough();

const counter = z.number().catch(0);

const summarySchema = z
  .object({
    totalRequests: counter,
    passedRequests: counter,
    failedRequests: counter,
    errorRequests: counter,
    skippedRequests: counter,
    totalAssertions: counter,
    passedAssertions: counter,
    failedAssertions: counter,
    totalTests: counter,
    passedTests: counter,
    failedTests: counter,
    totalPreRequestTests: counter,
    passedPreRequestTests: counter,
    failedPreRequestTests: counter,
    totalPostResponseTests: counter,
    passedPostResponseTests: counter,
    failedPostResponseTests: counter,
  })
  .passthrough();

const iterationSchema = z
  .object({
    iterationIndex: z.number().catch(0),
    results: z.array(resultSchema).catch([]),
    summary: summarySchema,
  })
  .passthrough();

export const EMPTY_SUMMARY: BrunoReportSummary = {
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

/**
 * Bruno normally writes an array of iterations, but single-iteration runs are
 * sometimes written as a bare object. Both shapes normalize to an array here.
 */
export function parseArtifact(contents: Buffer): BrunoReport[] {
  const raw: unknown = JSON.parse(contents.toString('utf-8'));
  const iterations = Array.isArray(raw) ? raw : [raw];
  return iterations.map((iteration, index) => {
    const parsed = iterationSchema.parse({ summary: EMPTY_SUMMARY, ...(iteration as object) });
    return { ...parsed, iterationIndex: parsed.iterationIndex || index } as BrunoReport;
  });
}

export function sumSummaries(summaries: BrunoReportSummary[]): BrunoReportSummary {
  return summaries.reduce<BrunoReportSummary>(
    (total, summary) => {
      const merged = { ...total };
      for (const key of Object.keys(EMPTY_SUMMARY) as Array<keyof BrunoReportSummary>) {
        merged[key] = total[key] + (summary[key] ?? 0);
      }
      return merged;
    },
    { ...EMPTY_SUMMARY },
  );
}

export function deriveRunStatus(summary: BrunoReportSummary): 'pass' | 'fail' {
  const failed =
    summary.failedRequests +
    summary.errorRequests +
    summary.failedAssertions +
    summary.failedTests +
    summary.failedPreRequestTests +
    summary.failedPostResponseTests;
  return failed > 0 ? 'fail' : 'pass';
}
