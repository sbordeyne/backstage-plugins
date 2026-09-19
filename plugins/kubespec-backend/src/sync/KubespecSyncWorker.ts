import type { LoggerService } from '@backstage/backend-plugin-api';
import type { KubespecSourceKind } from '@sbordeyne/kubespec-common';

import type { KubespecConfig, KubernetesSourceConfig, ProjectSourceConfig } from '../config';
import type { KubespecStore } from '../database/KubespecStore';
import type { NewChangeSummary, NewResource, ResourceKey } from '../database/types';
import type { GithubClient, GithubFile } from '../github/GithubClient';
import { selectTags } from '../github/selectTags';
import { collapseToLatestApiVersions } from '../kube/collapse';
import { ManifestFile, normalizeCrds } from '../kube/crds';
import { diffDefinitions } from '../kube/diff';
import { flattenDefinition } from '../kube/flatten';
import type { ExpansionLimits, NormalizedResource } from '../kube/model';
import { deserializeDefinition, serializeDefinition } from '../kube/serialize';
import { SwaggerDocument, normalizeSwagger } from '../kube/swagger';
import { compareStrings, versionSortKey } from '../kube/versions';
import { mapWithConcurrency } from '../util/concurrency';
import { contentHashOf } from './contentHash';

export interface SyncStats {
  sourcesPlanned: number;
  sourcesFailed: number;
  versionsSelected: number;
  versionsSkippedUnchanged: number;
  versionsSkippedOverBudget: number;
  versionsSkippedOutOfTime: number;
  versionsIngested: number;
  versionsFailed: number;
  versionsPruned: number;
  sourcesPruned: number;
  resourcesWritten: number;
  changesWritten: number;
  githubRequests: number;
}

export interface KubespecSyncWorkerOptions {
  store: KubespecStore;
  github: GithubClient;
  logger: LoggerService;
  config: KubespecConfig;
}

/** One source as the planner sees it, whichever kind it is. */
interface SourcePlan {
  slug: string;
  name: string;
  kind: KubespecSourceKind;
  repo: string;
  logoUrl?: string;
  displayOrder: number;
  versions: PlannedVersion[];
  tagsEtag?: string;
  kubernetes?: KubernetesSourceConfig;
  project?: ProjectSourceConfig;
}

interface TickBudget {
  remaining: number;
  /** Epoch milliseconds after which no new version is started. */
  deadline: number;
}

interface PlannedVersion {
  version: string;
  upstreamRef: string;
  sortKey: string;
}

interface FetchedVersion {
  sourceBytes: number;
  files: ManifestFile[];
}

/**
 * A version's inputs identified but not yet downloaded.
 *
 * The split is what makes a steady-state sync nearly free: the listing already
 * carries every blob's sha, so an unchanged version is recognised and skipped
 * without transferring a single file body.
 */
interface ResolvedVersion {
  contentHash: string;
  download: () => Promise<FetchedVersion>;
}

export class KubespecSyncWorker {
  constructor(private readonly options: KubespecSyncWorkerOptions) {}

  async syncOnce(abortSignal?: AbortSignal): Promise<SyncStats> {
    const stats = emptyStats();
    const { logger, config, store } = this.options;

    const sources = this.configuredSources();
    logger.info(
      `Kubespec sync starting (${sources.length} sources, search scope '${config.search.scope}', ` +
        `up to ${config.sync.maxVersionsPerTick} versions this tick)`,
    );

    if (abortSignal?.aborted) {
      // Already aborted means the backend is shutting down, not a failure.
      logger.info('Kubespec sync skipped because it was already aborted');
      return stats;
    }

    // Shared across sources so one very stale project cannot consume a whole tick
    // on its own while the others never get a turn.
    //
    // The deadline is what keeps a tick shorter than the scheduler's timeout.
    // That matters more than it looks: the timeout is also how long an abandoned
    // run ticket blocks every manual trigger, because nothing extends a ticket
    // while a worker holds it and only the janitor clears an expired one. Sizing
    // the timeout for a whole cold ingest would mean a restarted pod locks the
    // sync out for that long, so the tick stops on time instead and the rest of
    // the work resumes next tick — every version is committed on its own, and an
    // unchanged one is skipped without being downloaded.
    const budget: TickBudget = {
      remaining: config.sync.maxVersionsPerTick,
      deadline: Date.now() + config.sync.maxTickDurationMs,
    };

    // A source nobody has managed to ingest yet goes first. Otherwise a tick's
    // budget is spent re-checking sources that already have data, and a newly
    // configured one stays invisible for as many days as it takes the others to
    // come round.
    const populated = new Set(
      (await store.listSources()).filter(source => source.versionCount > 0).map(source => source.slug),
    );
    sources.sort((a, b) => Number(populated.has(a.slug)) - Number(populated.has(b.slug)));

    await mapWithConcurrency(sources, config.sync.concurrency, async source => {
      try {
        const plan = await this.step(`plan ${source.slug}`, abortSignal, () => this.planSource(source, abortSignal));
        stats.sourcesPlanned += 1;
        await this.ingestSource(plan, budget, stats, abortSignal);
      } catch (error) {
        stats.sourcesFailed += 1;
        logger.error(`Kubespec sync failed for source '${source.slug}'`, error as Error);
        await store.recordSourceSync(source.slug, { status: 'failed', error: (error as Error).message });
      }
    });

    if (config.pruneUnknownSources) {
      // Keyed on what is configured, not on what planned successfully: a source
      // whose listing failed still exists, and dropping it would delete every
      // stored version of it because GitHub was briefly unreachable.
      const removed = await store.pruneSources(sources.map(source => source.slug));
      stats.sourcesPruned = removed.length;
      if (removed.length > 0) {
        logger.info(`Kubespec removed ${removed.length} source(s) no longer in config: ${removed.join(', ')}`);
      }
    }

    stats.githubRequests = this.options.github.requestCount;
    logger.info(`Kubespec sync finished: ${JSON.stringify(stats)}`);
    return stats;
  }

  private configuredSources(): SourcePlan[] {
    const { config } = this.options;
    const sources: SourcePlan[] = [];

    if (config.kubernetes) {
      sources.push({
        slug: config.kubernetes.slug,
        name: config.kubernetes.name,
        kind: 'kubernetes',
        repo: config.kubernetes.repo,
        logoUrl: config.kubernetes.logoUrl,
        displayOrder: -1,
        versions: [],
        kubernetes: config.kubernetes,
      });
    }

    for (const project of config.projects) {
      sources.push({
        slug: project.slug,
        name: project.name,
        kind: 'crd',
        repo: project.repo,
        logoUrl: project.logoUrl,
        displayOrder: project.order,
        versions: [],
        project,
      });
    }

    return sources;
  }

  private async planSource(source: SourcePlan, abortSignal?: AbortSignal): Promise<SourcePlan> {
    const { store, github } = this.options;
    await store.upsertSource({
      slug: source.slug,
      name: source.name,
      kind: source.kind,
      repo: source.repo,
      logoUrl: source.logoUrl,
      displayOrder: source.displayOrder,
    });

    if (source.kubernetes) {
      // No tag listing at all: the minors are pinned, so the only question is what
      // each one's tag is called.
      const versions = source.kubernetes.minors.map(minor => ({
        version: minor,
        upstreamRef: source.kubernetes!.refTemplate.replace('{minor}', minor),
        sortKey: versionSortKey(minor),
      }));
      return { ...source, versions: sortAscending(versions) };
    }

    const project = source.project!;

    // Deliberately unconditional. Sending the stored ETag saved one request per
    // source per tick, but a 304 left nothing to apply the tag rules to, so the
    // plan fell back to the versions already stored — which means an edited rule
    // never took effect until upstream happened to publish a tag, and a source
    // whose versions had all failed planned nothing again, forever. Loki and
    // Cluster API were both stuck that way. A full sync costs ~320 requests
    // against a 5,000/hour budget, so the saving was never worth that.
    const listing = await this.step(`list tags for ${source.slug}`, abortSignal, () => github.listTags(source.repo));

    const selected = selectTags(listing.tags, project.tags);
    return {
      ...source,
      tagsEtag: listing.etag,
      versions: sortAscending(
        selected.map(tag => ({ version: tag.version, upstreamRef: tag.tag, sortKey: tag.sortKey })),
      ),
    };
  }

  private async ingestSource(
    plan: SourcePlan,
    budget: TickBudget,
    stats: SyncStats,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    const { store, logger, config } = this.options;
    const stored = new Map((await store.listStoredVersions(plan.slug)).map(version => [version.version, version]));
    const force = await store.isForceResyncRequested(plan.slug);

    stats.versionsSelected += plan.versions.length;
    let failures = 0;
    let degraded = 0;

    // Strictly ascending and sequential: each version's change list is diffed
    // against the one before it, which has to already be in the database.
    for (const planned of plan.versions) {
      if (abortSignal?.aborted) {
        logger.info(`Kubespec sync aborted part way through '${plan.slug}'`);
        break;
      }

      if (Date.now() >= budget.deadline) {
        // Stopping cleanly rather than being cut off by the scheduler: an aborted
        // run leaves its ticket behind, and that ticket is what blocks the next
        // manual sync.
        stats.versionsSkippedOutOfTime += 1;
        continue;
      }

      const existing = stored.get(planned.version);
      try {
        const resolved = await this.step(`resolve ${plan.slug} ${planned.version}`, abortSignal, () =>
          this.resolveVersion(plan, planned),
        );

        if (!force && existing?.state === 'ready' && existing.contentHash === resolved.contentHash) {
          stats.versionsSkippedUnchanged += 1;
          continue;
        }

        if (budget.remaining <= 0) {
          stats.versionsSkippedOverBudget += 1;
          continue;
        }
        budget.remaining -= 1;

        const fetched = await this.step(`fetch ${plan.slug} ${planned.version}`, abortSignal, resolved.download);

        const warnings = await this.step(`ingest ${plan.slug} ${planned.version}`, abortSignal, () =>
          this.ingestVersion(plan, planned, resolved.contentHash, fetched, stats),
        );
        stats.versionsIngested += 1;
        if (warnings > 0) {
          degraded += 1;
        }
      } catch (error) {
        failures += 1;
        stats.versionsFailed += 1;
        logger.error(`Kubespec failed to ingest ${plan.slug} ${planned.version}`, error as Error);
        await store.markVersionFailed(plan.slug, planned.version, (error as Error).message);
      }
    }

    const newest = plan.versions[plan.versions.length - 1];
    if (newest) {
      const refreshed = await store.listStoredVersions(plan.slug);
      const latest = refreshed.find(version => version.version === newest.version && version.state === 'ready');
      if (latest) {
        await store.setLatestVersion(plan.slug, latest.id);
        if (config.search.scope === 'latest') {
          await store.pruneProperties(plan.slug, latest.id);
        }
      }
    }

    if (force) {
      await store.clearForceResync(plan.slug);
    }

    stats.versionsPruned += await store.pruneVersions(
      plan.slug,
      plan.versions.map(version => version.version),
    );

    await store.recordSourceSync(plan.slug, {
      // A version that only parsed because the reader tolerated malformed YAML is
      // reported too: the data is usable but incomplete, and saying nothing would
      // present it as if upstream were clean.
      status: failures === 0 && degraded === 0 ? 'ok' : 'partial',
      error: describeOutcome(failures, degraded),
      tagsEtag: plan.tagsEtag,
    });
  }

  /**
   * Identifies a version's inputs and fingerprints them, without downloading any.
   *
   * Returns a closure for the bodies so the caller can decide, from the
   * fingerprint alone, whether they are worth fetching at all.
   */
  private async resolveVersion(plan: SourcePlan, planned: PlannedVersion): Promise<ResolvedVersion> {
    const { github, config } = this.options;

    if (plan.kubernetes) {
      const [file] = await github.collectManifests({
        repo: plan.repo,
        ref: planned.upstreamRef,
        paths: [plan.kubernetes.specPath],
        pathsMode: 'first',
      });
      if (!file) {
        throw new Error(`No spec at ${plan.kubernetes.specPath} for ${planned.upstreamRef}`);
      }

      return {
        contentHash: contentHashOf([{ path: file.path, sha: file.sha }]),
        download: async () => {
          const contents = await github.download(plan.repo, file.downloadUrl, config.sync.maxSpecBytes);
          return { sourceBytes: contents.length, files: [{ path: file.path, contents }] };
        },
      };
    }

    const project = plan.project!;
    if (project.releaseAsset) {
      const asset = await github.findReleaseAsset(plan.repo, planned.upstreamRef, project.releaseAsset);
      if (!asset) {
        throw new Error(`Release ${planned.upstreamRef} has no asset named '${project.releaseAsset}'`);
      }

      return {
        // A release asset has no blob sha, so its identity is the asset's own
        // mutable metadata — which is exactly what changes when it is replaced.
        contentHash: contentHashOf([{ path: asset.name, sha: `${asset.id}:${asset.size}:${asset.updatedAt}` }]),
        download: async () => {
          const contents = await github.download(plan.repo, asset.downloadUrl, config.sync.maxSpecBytes);
          return { sourceBytes: contents.length, files: [{ path: asset.name, contents }] };
        },
      };
    }

    const found = await github.collectManifests({
      repo: plan.repo,
      ref: planned.upstreamRef,
      paths: project.paths,
      pathsMode: project.pathsMode,
    });
    if (found.length === 0) {
      throw new Error(`No manifests at any of [${project.paths.join(', ')}] for ${planned.upstreamRef}`);
    }

    return {
      contentHash: contentHashOf(found.map(file => ({ path: file.path, sha: file.sha }))),
      download: async () => {
        const files = await this.downloadAll(plan.repo, found);
        return { sourceBytes: files.reduce((total, file) => total + file.contents.length, 0), files };
      },
    };
  }

  private async downloadAll(repo: string, found: readonly GithubFile[]): Promise<ManifestFile[]> {
    const { github, config } = this.options;
    const files: ManifestFile[] = new Array(found.length);

    await mapWithConcurrency(found, config.sync.fileConcurrency, async (file, index) => {
      files[index] = {
        path: file.path,
        contents: await github.download(repo, file.downloadUrl, config.sync.maxSpecBytes),
      };
    });

    return files;
  }

  /** Returns how many parse warnings the version produced. */
  private async ingestVersion(
    plan: SourcePlan,
    planned: PlannedVersion,
    contentHash: string,
    fetched: FetchedVersion,
    stats: SyncStats,
  ): Promise<number> {
    const { store, config, logger } = this.options;
    const limits: ExpansionLimits = {
      maxNodes: config.sync.maxResourceNodes,
      maxDepth: config.sync.maxResourceDepth,
    };

    const { resources, warnings } = this.normalize(plan, fetched, limits);
    for (const warning of warnings.slice(0, 10)) {
      logger.warn(`Kubespec ${plan.slug} ${planned.version}: ${warning}`);
    }

    const collapsed = collapseToLatestApiVersions(resources);
    if (collapsed.length === 0) {
      // Manifests were found but held no v1 CustomResourceDefinition — a project
      // that still ships v1beta1 CRDs, or a path that now points somewhere else.
      // Recorded as a failure rather than stored as a version with nothing in it.
      throw new Error(`No resources found in ${fetched.files.length} manifest file(s)`);
    }

    const previous = await this.previousVersionId(plan.slug, planned.sortKey);
    const indexProperties = config.search.scope === 'all' || isNewest(plan, planned);

    const newResources: NewResource[] = [];
    const summaries: NewChangeSummary[] = [];
    const seen = new Set<string>();

    for (const resource of collapsed) {
      const key: ResourceKey = {
        apiGroup: resource.group,
        apiVersion: resource.version,
        kind: resource.kind,
      };
      seen.add(keyOf(key));

      const serialized = serializeDefinition(resource.definition);
      newResources.push({
        ...key,
        apiVersionFull: resource.apiVersionFull,
        category: resource.category,
        scope: resource.scope,
        description: resource.definition.description,
        propertyCount: resource.propertyCount,
        treeDepth: resource.treeDepth,
        definitionGzip: serialized.gzip,
        definitionBytes: serialized.bytes,
        definitionHash: serialized.hash,
        truncated: resource.truncated,
        properties: indexProperties ? flattenDefinition(resource.definition, { maxDepth: config.search.maxDepth }) : [],
      });

      summaries.push(await this.summaryFor(previous, key, resource));
    }

    if (previous) {
      // A kind that disappeared gets one row saying so, rather than a removal
      // entry for every property it used to have.
      for (const key of await store.listResourceKeys(previous)) {
        if (!seen.has(keyOf(key))) {
          summaries.push({
            ...key,
            previousVersionId: previous,
            isNewGvk: false,
            isRemovedGvk: true,
            addedCount: 0,
            removedCount: 0,
            descriptionChangedCount: 0,
            descriptionChangedPaths: 0,
            typeChangedCount: 0,
            typeChangedPaths: 0,
            changes: [],
          });
        }
      }
    }

    await store.ingestVersion({
      version: {
        sourceSlug: plan.slug,
        version: planned.version,
        upstreamRef: planned.upstreamRef,
        sortKey: planned.sortKey,
        contentHash,
        sourceBytes: fetched.sourceBytes,
      },
      resources: newResources,
      summaries,
    });

    stats.resourcesWritten += newResources.length;
    stats.changesWritten += summaries.reduce((total, summary) => total + summary.changes.length, 0);

    // The version after this one was diffed against what used to be here.
    const successor = await this.successorVersionId(plan.slug, planned.sortKey);
    if (successor) {
      await store.markChangesStale(successor);
    }

    return warnings.length;
  }

  private normalize(
    plan: SourcePlan,
    fetched: FetchedVersion,
    limits: ExpansionLimits,
  ): { resources: NormalizedResource[]; warnings: string[] } {
    if (!plan.kubernetes) {
      return normalizeCrds(fetched.files, limits);
    }

    const document = JSON.parse(fetched.files[0].contents) as SwaggerDocument;
    return normalizeSwagger(document, {
      limits,
      categoryByKind: plan.kubernetes.categoryByKind,
      defaultCategory: plan.kubernetes.defaultCategory,
    });
  }

  private async summaryFor(
    previousVersionId: string | undefined,
    key: ResourceKey,
    resource: NormalizedResource,
  ): Promise<NewChangeSummary> {
    const base = {
      ...key,
      previousVersionId,
      isRemovedGvk: false,
    };

    const before = previousVersionId ? await this.options.store.getStoredDefinition(previousVersionId, key) : undefined;

    if (!before) {
      return {
        ...base,
        isNewGvk: previousVersionId !== undefined,
        addedCount: 0,
        removedCount: 0,
        descriptionChangedCount: 0,
        descriptionChangedPaths: 0,
        typeChangedCount: 0,
        typeChangedPaths: 0,
        changes: [],
      };
    }

    const diff = diffDefinitions(deserializeDefinition(before.definitionGzip), resource.definition);
    return { ...base, isNewGvk: false, ...diff };
  }

  private async previousVersionId(sourceSlug: string, sortKey: string): Promise<string | undefined> {
    const stored = await this.options.store.listStoredVersions(sourceSlug);
    const candidates = stored.filter(version => version.state === 'ready' && version.sortKey < sortKey);
    return candidates[candidates.length - 1]?.id;
  }

  private async successorVersionId(sourceSlug: string, sortKey: string): Promise<string | undefined> {
    const stored = await this.options.store.listStoredVersions(sourceSlug);
    return stored.find(version => version.state === 'ready' && version.sortKey > sortKey)?.id;
  }

  /**
   * Bounds a phase by the scheduler's abort signal.
   *
   * Neither Octokit nor knex takes an AbortSignal, so without this a stalled
   * request outlives the task timeout while still holding the task claim, and no
   * replica can take over.
   *
   * The signal fires for a shutdown as readily as for a timeout, and the two are
   * indistinguishable from here, so the message says only that the phase was cut
   * short — calling every interrupted backend restart a timeout sends the reader
   * looking for a slow request that was never there.
   */
  private async step<T>(description: string, abortSignal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
    if (!abortSignal || abortSignal.aborted) {
      return run();
    }

    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new Error(`Kubespec sync was interrupted trying to ${description}`));
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
}

function describeOutcome(failures: number, degraded: number): string | undefined {
  const notes: string[] = [];
  if (failures > 0) {
    notes.push(`${failures} version(s) failed to ingest`);
  }
  if (degraded > 0) {
    notes.push(`${degraded} version(s) recovered from malformed upstream YAML`);
  }
  return notes.length > 0 ? notes.join('; ') : undefined;
}

function sortAscending(versions: readonly PlannedVersion[]): PlannedVersion[] {
  return [...versions].sort((a, b) => compareStrings(a.sortKey, b.sortKey));
}

function isNewest(plan: SourcePlan, planned: PlannedVersion): boolean {
  return plan.versions[plan.versions.length - 1]?.version === planned.version;
}

function keyOf(key: ResourceKey): string {
  return `${key.apiGroup}/${key.apiVersion}/${key.kind}`;
}

function emptyStats(): SyncStats {
  return {
    sourcesPlanned: 0,
    sourcesFailed: 0,
    versionsSelected: 0,
    versionsSkippedUnchanged: 0,
    versionsSkippedOverBudget: 0,
    versionsSkippedOutOfTime: 0,
    versionsIngested: 0,
    versionsFailed: 0,
    versionsPruned: 0,
    sourcesPruned: 0,
    resourcesWritten: 0,
    changesWritten: 0,
    githubRequests: 0,
  };
}
