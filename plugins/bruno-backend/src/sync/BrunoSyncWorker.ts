import type { AuthService, LoggerService } from '@backstage/backend-plugin-api';
import { CATALOG_FILTER_EXISTS } from '@backstage/catalog-client';
import { stringifyEntityRef } from '@backstage/catalog-model';
import type { catalogServiceRef } from '@backstage/plugin-catalog-node';
import type { BrunoReport } from '@sbordeyne/bruno-report-type';
import { createHash, randomUUID } from 'node:crypto';

import type { BrunoConfig } from '../config';
import type { BrunoStore } from '../database/BrunoStore';
import type { InsertRunInput, NewResult } from '../database/types';
import type { BrunoArtifactRef, BrunoArtifactSource, BrunoSourceType } from '../sources';
import { mapWithConcurrency } from '../util/concurrency';
import { deriveRunStatus, parseArtifact, sumSummaries } from './parseArtifact';

export interface SyncStats {
  listed: number;
  unmatched: number;
  skippedTooLarge: number;
  skippedTooOld: number;
  downloaded: number;
  inserted: number;
  failed: number;
  pruned: number;
  orphaned: number;
}

interface Candidate {
  ref: BrunoArtifactRef;
  sourceType: BrunoSourceType;
  reportName: string;
  entityRef: string;
  runKey: string;
}

export interface BrunoSyncWorkerOptions {
  store: BrunoStore;
  source: BrunoArtifactSource;
  catalog: typeof catalogServiceRef.T;
  auth: AuthService;
  logger: LoggerService;
  config: BrunoConfig;
}

export class BrunoSyncWorker {
  constructor(private readonly options: BrunoSyncWorkerOptions) {}

  async syncOnce(abortSignal?: AbortSignal): Promise<SyncStats> {
    const stats = emptyStats();
    const { logger, config } = this.options;

    // Logged before any I/O: without it a tick that stalls on the catalog or on
    // storage is indistinguishable from one that never started.
    logger.info(
      `Bruno sync starting (source '${describeSource(config.source)}', ` +
        `annotation '${config.reportAnnotation}', retention ${config.retention.runsPerEntity})`,
    );

    if (abortSignal?.aborted) {
      // Already aborted means the backend is shutting down, which is not a failure.
      logger.info('Bruno sync skipped because it was already aborted');
      return stats;
    }

    try {
      const entityRefsByReportName = await this.step('resolve report owners from the catalog', abortSignal, () =>
        this.loadReportOwners(),
      );
      if (entityRefsByReportName.size === 0) {
        // A catalog blip must never be read as "every report is orphaned".
        logger.warn(
          `No catalog entity carries the '${config.reportAnnotation}' annotation, so there is nothing to sync. ` +
            `Add it to a Component or System, with the report file name as its value (for example 'users.json').`,
        );
        return stats;
      }
      logger.info(`Bruno sync matched ${entityRefsByReportName.size} report name(s) to catalog entities`);

      const candidates = await this.step('list storage objects', abortSignal, () =>
        this.collectCandidates(entityRefsByReportName, stats, abortSignal),
      );
      logger.info(
        `Bruno sync listed ${stats.listed} object(s): ${candidates.length} claimed, ${stats.unmatched} unmatched, ` +
          `${stats.skippedTooOld} too old, ${stats.skippedTooLarge} too large`,
      );

      const retained = this.applyRetention(candidates);
      const pending = await this.filterAlreadySynced(retained);
      logger.info(`Bruno sync has ${pending.length} new artifact(s) to download`);

      await mapWithConcurrency(pending, config.sync.concurrency, async candidate => {
        if (abortSignal?.aborted) {
          return;
        }
        await this.ingestCandidate(candidate, stats);
      });

      stats.pruned = await this.pruneRetention();
      stats.orphaned = await this.options.store.pruneOrphanedEntities([...new Set(candidates.map(c => c.entityRef))]);

      logger.info('Bruno sync finished', { ...stats });
      return stats;
    } catch (error) {
      // Report how far the tick got — a bare stack trace hides which step stalled.
      logger.error(`Bruno sync failed after ${JSON.stringify(stats)}`, error as Error);
      throw error;
    }
  }

  /**
   * Runs one step of the tick under the task's abort signal.
   *
   * The catalog and storage clients do not accept an AbortSignal, so without this
   * a hung dependency would block forever: the scheduler's timeout would fire,
   * but the task would keep its claim and never log again, which looks exactly
   * like a worker that never ran.
   */
  private async step<T>(description: string, abortSignal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
    if (!abortSignal || abortSignal.aborted) {
      return run();
    }

    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new Error(`Bruno sync timed out trying to ${description}`));
      abortSignal.addEventListener('abort', onAbort, { once: true });
    });

    try {
      return await Promise.race([run(), aborted]);
    } finally {
      if (onAbort) {
        abortSignal.removeEventListener('abort', onAbort);
      }
    }
  }

  /** report name -> every entity ref claiming it. */
  private async loadReportOwners(): Promise<Map<string, string[]>> {
    const { catalog, auth, logger, config } = this.options;
    const credentials = await auth.getOwnServiceCredentials();

    const { items } = await catalog.getEntities(
      {
        filter: { [`metadata.annotations.${config.reportAnnotation}`]: CATALOG_FILTER_EXISTS },
        fields: ['kind', 'metadata.name', 'metadata.namespace', 'metadata.annotations'],
      },
      { credentials },
    );

    const owners = new Map<string, string[]>();
    for (const entity of items) {
      const reportName = entity.metadata.annotations?.[config.reportAnnotation];
      if (!reportName) {
        continue;
      }
      const entityRef = stringifyEntityRef(entity).toLowerCase();
      const existing = owners.get(reportName);
      if (existing) {
        logger.warn(`Report '${reportName}' is claimed by multiple entities; each stores its own copy`);
        existing.push(entityRef);
      } else {
        owners.set(reportName, [entityRef]);
      }
    }
    return owners;
  }

  private async collectCandidates(
    entityRefsByReportName: Map<string, string[]>,
    stats: SyncStats,
    abortSignal?: AbortSignal,
  ): Promise<Candidate[]> {
    const { source, config } = this.options;
    const cutoff = config.sync.maxArtifactAgeMs ? Date.now() - config.sync.maxArtifactAgeMs : undefined;
    const candidates: Candidate[] = [];

    for await (const ref of source.list(abortSignal)) {
      if (abortSignal?.aborted) {
        break;
      }
      stats.listed++;

      // Only the last segment identifies the report. Which artifacts a source
      // offers at all — a prefix, a suite directory, a branch — is the source's
      // own business, so that a GitHub artifact with no path matches the same way
      // an object 5 directories deep does.
      const segments = ref.name.split('/');
      const reportName = segments[segments.length - 1];

      const entityRefs = entityRefsByReportName.get(reportName);
      if (!entityRefs) {
        stats.unmatched++;
        continue;
      }
      if (cutoff !== undefined && ref.createdAt.getTime() < cutoff) {
        stats.skippedTooOld++;
        continue;
      }
      if (ref.sizeBytes !== undefined && ref.sizeBytes > config.sync.maxObjectSizeBytes) {
        stats.skippedTooLarge++;
        continue;
      }

      for (const entityRef of entityRefs) {
        candidates.push({
          ref,
          sourceType: source.type,
          reportName,
          entityRef,
          runKey: buildRunKey(ref, entityRef),
        });
      }
    }

    return candidates;
  }

  /**
   * Caps each entity to the newest N artifacts *before* downloading. This is what
   * keeps a whole-prefix listing affordable — otherwise a backlog would be
   * downloaded in full only to be pruned straight afterwards.
   */
  private applyRetention(candidates: Candidate[]): Candidate[] {
    const keep = this.options.config.retention.runsPerEntity;
    if (keep < 0) {
      return candidates;
    }

    const byEntity = new Map<string, Candidate[]>();
    for (const candidate of candidates) {
      const bucket = byEntity.get(candidate.entityRef);
      if (bucket) {
        bucket.push(candidate);
      } else {
        byEntity.set(candidate.entityRef, [candidate]);
      }
    }

    return [...byEntity.values()].flatMap(group =>
      group.sort((a, b) => b.ref.createdAt.getTime() - a.ref.createdAt.getTime()).slice(0, keep),
    );
  }

  private async filterAlreadySynced(candidates: Candidate[]): Promise<Candidate[]> {
    const existing = await this.options.store.listExistingRunKeys(candidates.map(candidate => candidate.runKey));
    return candidates.filter(candidate => !existing.has(candidate.runKey));
  }

  private async ingestCandidate(candidate: Candidate, stats: SyncStats): Promise<void> {
    const { source, store, logger, config } = this.options;
    try {
      const contents = await source.download(candidate.ref);
      stats.downloaded++;

      const iterations = parseArtifact(contents);
      const input = buildInsertRunInput(candidate, iterations, config.sync.maxStoredBodyBytes);

      const { inserted } = await store.insertRun(input);
      if (!inserted) {
        return;
      }
      stats.inserted++;
      await store.deleteSupersededRuns({
        entityRef: candidate.entityRef,
        artifactSource: candidate.ref.source,
        artifactPath: candidate.ref.name,
        keepRunId: input.run.id,
      });
    } catch (error) {
      // One poison artifact must never abort the tick.
      stats.failed++;
      logger.error(`Failed to sync Bruno artifact '${candidate.ref.name}'`, error as Error);
    }
  }

  private async pruneRetention(): Promise<number> {
    const keep = this.options.config.retention.runsPerEntity;
    if (keep < 0) {
      return 0;
    }
    // Prune every entity that has rows, not just the ones touched this tick, or
    // lowering the retention never takes effect for idle entities.
    const entityRefs = await this.options.store.listEntityRefsWithRuns();
    let pruned = 0;
    for (const entityRef of entityRefs) {
      pruned += await this.options.store.pruneRunsForEntity(entityRef, keep);
    }
    return pruned;
  }
}

function emptyStats(): SyncStats {
  return {
    listed: 0,
    unmatched: 0,
    skippedTooLarge: 0,
    skippedTooOld: 0,
    downloaded: 0,
    inserted: 0,
    failed: 0,
    pruned: 0,
    orphaned: 0,
  };
}

function buildRunKey(ref: BrunoArtifactRef, entityRef: string): string {
  return createHash('sha256').update(`${ref.source}\n${ref.name}\n${ref.version}\n${entityRef}`).digest('hex');
}

/** One line naming where a tick is reading from, whichever kind of source it is. */
function describeSource(source: BrunoConfig['source']): string {
  switch (source.type) {
    case 'github':
      return `github://${source.owner}/${source.repo}`;
    case 's3':
      return `s3://${source.bucket}/${source.prefix}`;
    default:
      return `gs://${source.bucket}/${source.prefix}`;
  }
}

export function buildInsertRunInput(
  candidate: Candidate,
  iterations: BrunoReport[],
  maxStoredBodyBytes: number,
): InsertRunInput {
  const runId = randomUUID();
  const summary = sumSummaries(iterations.map(iteration => iteration.summary));

  const results: NewResult[] = [];
  let seq = 0;
  for (const iteration of iterations) {
    for (const result of iteration.results) {
      results.push(toNewResult(result, iteration.iterationIndex, seq++, maxStoredBodyBytes));
    }
  }

  return {
    run: {
      id: runId,
      runKey: candidate.runKey,
      entityRef: candidate.entityRef,
      reportName: candidate.reportName,
      sourceType: candidate.sourceType,
      artifactSource: candidate.ref.source,
      artifactPath: candidate.ref.name,
      artifactVersion: candidate.ref.version,
      artifactEtag: candidate.ref.etag ?? null,
      artifactSizeBytes: candidate.ref.sizeBytes ?? null,
      artifactCreatedAt: candidate.ref.createdAt,
      iterationCount: iterations.length,
      status: deriveRunStatus(summary),
      summary,
    },
    results,
  };
}

function toNewResult(
  result: BrunoReport['results'][number],
  iterationIndex: number,
  seq: number,
  maxStoredBodyBytes: number,
): NewResult {
  const responseBody = truncate(stringifyBody(result.response.data), maxStoredBodyBytes);
  const requestBody = truncate(result.request.data ?? null, maxStoredBodyBytes);

  return {
    id: randomUUID(),
    seq,
    iterationIndex: result.iterationIndex ?? iterationIndex,
    name: result.name || null,
    path: result.path || null,
    testFilename: result.test?.filename || null,
    status: result.status,
    requestMethod: result.request.method || null,
    requestUrl: result.request.url || null,
    responseStatus: result.response.status ?? null,
    responseStatusText: result.response.statusText || null,
    responseTimeMs: Math.round(result.response.responseTime ?? 0),
    runDurationMs: Math.round(result.runDuration ?? 0),
    error: result.error ?? null,
    assertionsTotal: result.assertionResults.length,
    assertionsPassed: result.assertionResults.filter(entry => entry.status === 'pass').length,
    testsTotal: result.testResults.length,
    testsPassed: result.testResults.filter(entry => entry.status === 'pass').length,
    detail: {
      requestHeaders: result.request.headers ?? {},
      requestBody: requestBody.text,
      responseHeaders: result.response.headers ?? {},
      responseBody: responseBody.text,
      responseBodyTruncated: responseBody.truncated || requestBody.truncated,
      assertionResults: result.assertionResults,
      testResults: result.testResults,
      preRequestTestResults: result.preRequestTestResults,
      postResponseTestResults: result.postResponseTestResults,
    },
  };
}

function stringifyBody(data: unknown): string | null {
  if (data === null || data === undefined) {
    return null;
  }
  if (typeof data === 'string') {
    return data;
  }
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

function truncate(text: string | null, maxBytes: number): { text: string | null; truncated: boolean } {
  if (text === null || text.length <= maxBytes) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, maxBytes), truncated: true };
}
