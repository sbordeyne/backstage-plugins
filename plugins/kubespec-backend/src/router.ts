import type { HttpAuthService, SchedulerService } from '@backstage/backend-plugin-api';
import { InputError, NotFoundError } from '@backstage/errors';
import type {
  KubespecChangeType,
  KubespecPropertyHit,
  KubespecResourceListResponse,
  KubespecSearchResponse,
} from '@sbordeyne/kubespec-common';
import express from 'express';
import Router from 'express-promise-router';
import { gunzipSync } from 'zlib';
import { z } from 'zod';

import type { KubespecConfig } from './config';
import { KubespecStore } from './database/KubespecStore';
import { decodeChangeCursor, decodeSearchCursor, decodeVersionCursor } from './database/cursors';
import type { ResourceKey } from './database/types';

export const SYNC_TASK_ID = 'kubespec-sync';

/**
 * The path segment standing in for the core Kubernetes group, whose real name is
 * the empty string. A URL cannot carry an empty segment unambiguously, and the
 * frontend spells it the same way.
 */
const CORE_GROUP = 'core';

/** Schemas are immutable for a given version, but a force-pushed tag can replace
 * one under an unchanged URL — so they are revalidated rather than `immutable`. */
const CACHE_CONTROL = 'private, max-age=3600';

export interface RouterOptions {
  httpAuth: HttpAuthService;
  store: KubespecStore;
  scheduler: SchedulerService;
  config: KubespecConfig;
  syncEnabled: boolean;
}

const sourceQuery = z.object({
  source: z.string().min(1),
});

const versionsQuery = sourceQuery.extend({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

const resourcesQuery = sourceQuery.extend({
  version: z.string().min(1).optional(),
});

const resourceQuery = resourcesQuery.extend({
  group: z.string().default(CORE_GROUP),
  apiVersion: z.string().min(1),
  kind: z.string().min(1),
});

const changesQuery = resourceQuery.extend({
  type: z.enum(['new', 'removed', 'description', 'type']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

const metadataQuery = sourceQuery.extend({
  apiVersion: z.string().min(1),
  kind: z.string().min(1),
});

const searchQuery = z.object({
  q: z.string().min(2),
  source: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  scope: z.enum(['all', 'kinds', 'properties']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
});

export async function createRouter(options: RouterOptions): Promise<express.Router> {
  const { httpAuth, store, scheduler, config, syncEnabled } = options;
  const router = Router();
  router.use(express.json());

  async function requireUser(request: express.Request): Promise<void> {
    await httpAuth.credentials(request, { allow: ['user'] });
  }

  /** Resolves a source and version, or explains which of the two was missing. */
  async function resolve(sourceSlug: string, version?: string) {
    const resolved = await store.resolveVersion(sourceSlug, version);
    if (!resolved) {
      throw new NotFoundError(
        version && version !== 'latest'
          ? `No ingested version '${version}' of source '${sourceSlug}'`
          : `Source '${sourceSlug}' has no ingested versions yet`,
      );
    }
    return resolved;
  }

  router.get('/v1/sources', async (req, res) => {
    await requireUser(req);
    res.set('Cache-Control', 'private, max-age=300');
    res.json({ items: await store.listSources() });
  });

  router.get('/v1/versions', async (req, res) => {
    await requireUser(req);
    const query = parse(versionsQuery, req.query);
    res.json(
      await store.listVersions({
        sourceSlug: query.source,
        limit: query.limit,
        cursor: query.cursor ? decodeVersionCursor(query.cursor) : undefined,
      }),
    );
  });

  router.get('/v1/resources', async (req, res) => {
    await requireUser(req);
    const query = parse(resourcesQuery, req.query);
    const source = await requireSource(store, query.source);
    const version = await resolve(query.source, query.version);
    const items = await store.listResources(version.id);

    const response: KubespecResourceListResponse = {
      sourceSlug: source.slug,
      sourceName: source.name,
      requestedVersion: query.version ?? 'latest',
      resolvedVersion: version.version,
      isLatest: version.isLatest,
      categoryOrder: categoryOrderFor(config, source.kind, items),
      items,
    };

    res.set('Cache-Control', CACHE_CONTROL);
    res.json(response);
  });

  router.get('/v1/resource', async (req, res) => {
    await requireUser(req);
    const query = parse(resourceQuery, req.query);
    const source = await requireSource(store, query.source);
    const version = await resolve(query.source, query.version);
    const resource = await requireResource(store, version.id, keyOf(query));

    res.set('Cache-Control', CACHE_CONTROL);
    res.set('ETag', `"${resource.definitionHash}"`);
    // The schema itself is a separate request so that its stored gzip can be
    // served as-is; this envelope stays small and is what the page paints from.
    res.json({
      sourceSlug: source.slug,
      sourceName: source.name,
      sourceVersion: version.version,
      isLatest: version.isLatest,
      group: resource.group,
      apiVersion: resource.apiVersion,
      apiVersionFull: resource.apiVersionFull,
      kind: resource.kind,
      category: resource.category,
      scope: resource.scope,
      description: resource.description,
      propertyCount: resource.propertyCount,
      hasMetadata: resource.hasMetadata,
      definitionBytes: resource.definitionBytes,
      definitionHash: resource.definitionHash,
      truncated: resource.truncated,
    });
  });

  /**
   * The expanded schema, served straight out of the column it is stored in.
   *
   * The bytes were gzipped once at ingest, so this costs a row read and no CPU.
   */
  router.get('/v1/resource/schema', async (req, res) => {
    await requireUser(req);
    const query = parse(resourceQuery, req.query);
    const version = await resolve(query.source, query.version);
    const resource = await requireResource(store, version.id, keyOf(query));

    const etag = `"${resource.definitionHash}"`;
    res.set('Cache-Control', CACHE_CONTROL);
    res.set('ETag', etag);
    res.set('Vary', 'Accept-Encoding');
    res.type('application/json');

    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    if (req.acceptsEncodings('gzip')) {
      res.set('Content-Encoding', 'gzip');
      res.send(resource.definitionGzip);
      return;
    }

    res.send(gunzipSync(resource.definitionGzip));
  });

  router.get('/v1/changes/summary', async (req, res) => {
    await requireUser(req);
    const query = parse(resourceQuery, req.query);
    const version = await resolve(query.source, query.version);

    res.set('Cache-Control', CACHE_CONTROL);
    res.json({
      items: await store.listChangeSummaries({
        sourceSlug: query.source,
        sortKey: version.sortKey,
        key: keyOf(query),
      }),
    });
  });

  router.get('/v1/changes', async (req, res) => {
    await requireUser(req);
    const query = parse(changesQuery, req.query);
    const version = await resolve(query.source, query.version);

    res.set('Cache-Control', CACHE_CONTROL);
    res.json(
      await store.listChanges({
        versionId: version.id,
        key: keyOf(query),
        changeType: query.type as KubespecChangeType | undefined,
        limit: query.limit,
        cursor: query.cursor ? decodeChangeCursor(query.cursor) : undefined,
      }),
    );
  });

  router.get('/v1/metadata', async (req, res) => {
    await requireUser(req);
    const query = parse(metadataQuery, req.query);
    res.set('Cache-Control', CACHE_CONTROL);
    res.json(await store.getMetadata(query.source, query.apiVersion, query.kind));
  });

  router.get('/v1/search', async (req, res) => {
    await requireUser(req);
    const query = parse(searchQuery, req.query);
    const limit = query.limit ?? config.search.maxResults;
    const cursor = query.cursor ? decodeSearchCursor(query.cursor) : undefined;

    const response: KubespecSearchResponse = { resources: [], properties: [] };

    // Kinds are searched first and paged to exhaustion before property paths
    // start, so one "load more" walks a single ordered stream.
    if (query.scope !== 'properties' && cursor?.t !== 'p') {
      const hits = await store.searchResources({
        needle: query.q,
        sourceSlug: query.source,
        versionId: query.source ? (await resolve(query.source, query.version)).id : undefined,
        limit,
        cursor: cursor?.t === 'r' ? cursor : undefined,
      });
      response.resources = hits.items;
      if (hits.nextCursor) {
        res.json({ ...response, nextCursor: hits.nextCursor });
        return;
      }
    }

    // Property paths are indexed per version, so searching them needs a source to
    // pin one. Without a source the search stays at the kind level.
    if (query.scope !== 'kinds' && query.source) {
      const indexed = await indexedVersionFor(store, config, query.source, query.version);
      const hits = await store.searchProperties({
        needle: query.q,
        versionId: indexed.id,
        limit,
        cursor: cursor?.t === 'p' ? cursor : undefined,
      });
      response.properties = hits.items as KubespecPropertyHit[];
      if (indexed.fallbackFrom) {
        response.propertiesFromVersion = indexed.version;
      }
      if (hits.nextCursor) {
        response.nextCursor = hits.nextCursor;
      }
    }

    res.json(response);
  });

  router.get('/v1/status', async (req, res) => {
    await requireUser(req);
    res.json({ syncEnabled, items: await store.listSources() });
  });

  router.post('/v1/sync', async (req, res) => {
    await requireUser(req);
    if (!syncEnabled) {
      throw new NotFoundError('Kubespec sync is disabled; set kubespec.sync.enabled to true to schedule it');
    }

    // A force run re-reads every source, ignoring the content hashes that
    // normally skip unchanged versions. The flag is stored rather than passed to
    // the scheduler, which carries no parameters, and the worker clears it per
    // source so an interrupted rebuild resumes.
    const force = req.query.force === 'true';
    if (force) {
      await store.requestForceResync();
    }

    try {
      await scheduler.triggerTask(SYNC_TASK_ID);
      res.status(202).json({ triggered: true, force });
    } catch (error) {
      // The scheduler refuses to trigger a task that is already running. That is
      // not a failure from here: the caller asked for a sync to happen, and one
      // is happening. Surfacing the raw 409 only produced "Request failed with
      // 409 Conflict" on the page, which says nothing a reader can act on.
      if ((error as Error).name === 'ConflictError') {
        res.status(202).json({ triggered: false, alreadyRunning: true, force });
        return;
      }
      throw error;
    }
  });

  return router;
}

async function requireSource(store: KubespecStore, slug: string) {
  const source = (await store.listSources()).find(candidate => candidate.slug === slug);
  if (!source) {
    throw new NotFoundError(`No kubespec source '${slug}'`);
  }
  return source;
}

async function requireResource(store: KubespecStore, versionId: string, key: ResourceKey) {
  const resource = await store.getResource(versionId, key);
  if (!resource) {
    throw new NotFoundError(`No resource ${key.apiGroup || CORE_GROUP}/${key.apiVersion}/${key.kind} in that version`);
  }
  return resource;
}

/**
 * Picks the version whose property index can answer a search.
 *
 * Under the default `search.scope: 'latest'` only the newest version of a source
 * carries property rows. Answering an older version's search from the newest one
 * and saying so beats returning an empty result that looks like "no matches".
 */
async function indexedVersionFor(
  store: KubespecStore,
  config: KubespecConfig,
  sourceSlug: string,
  version?: string,
): Promise<{ id: string; version: string; fallbackFrom: boolean }> {
  const requested = await store.resolveVersion(sourceSlug, version);
  if (!requested) {
    throw new NotFoundError(`Source '${sourceSlug}' has no ingested versions yet`);
  }
  if (config.search.scope === 'all' || requested.isLatest) {
    return { ...requested, fallbackFrom: false };
  }

  const latest = await store.resolveVersion(sourceSlug);
  if (!latest) {
    return { ...requested, fallbackFrom: false };
  }
  return { id: latest.id, version: latest.version, fallbackFrom: true };
}

function keyOf(query: { group: string; apiVersion: string; kind: string }): ResourceKey {
  return {
    apiGroup: query.group === CORE_GROUP ? '' : query.group,
    apiVersion: query.apiVersion,
    kind: query.kind,
  };
}

/**
 * Category headings in display order.
 *
 * Kubernetes has a curated order that reads the way the API docs do; a CRD
 * source's categories are its API groups, which have no meaningful order beyond
 * alphabetical.
 */
function categoryOrderFor(
  config: KubespecConfig,
  sourceKind: string,
  items: ReadonlyArray<{ category: string }>,
): string[] {
  const present = [...new Set(items.map(item => item.category))];

  if (sourceKind !== 'kubernetes' || !config.kubernetes) {
    return present.sort();
  }

  const configured = config.kubernetes.categoryOrder.filter(category => present.includes(category));
  const rest = present.filter(category => !configured.includes(category)).sort();
  return [...configured, ...rest];
}

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new InputError(result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  }
  return result.data;
}
