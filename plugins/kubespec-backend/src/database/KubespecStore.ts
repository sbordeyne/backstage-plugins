import { DatabaseService, resolvePackagePath } from '@backstage/backend-plugin-api';
import type {
  KubespecChange,
  KubespecChangeSummary,
  KubespecChangeType,
  KubespecExample,
  KubespecLink,
  KubespecMetadata,
  KubespecPaginated,
  KubespecPropertyHit,
  KubespecResourceHit,
  KubespecResourceSummary,
  KubespecSourceSummary,
  KubespecVersionSummary,
} from '@sbordeyne/kubespec-common';
import { randomUUID } from 'crypto';
import type { Knex } from 'knex';

import { chunkSizeFor, chunked } from './chunking';
import { SearchCursor, VersionCursor, encodeChangeCursor, encodeSearchCursor, encodeVersionCursor } from './cursors';
import { toIsoString } from './timestamps';
import type {
  IngestVersionInput,
  MetadataEntry,
  MetadataLinkEntry,
  ResourceKey,
  SourceRecord,
  SourceSyncOutcome,
  StoredDefinition,
  StoredVersion,
} from './types';

export const migrationsDir = resolvePackagePath('@sbordeyne/backstage-plugin-kubespec-backend', 'migrations');

/**
 * Hand-authored examples and links. Resolved the same way as the migrations, and
 * covered by the same kind of smoke test: both directories have to be listed in
 * package.json `files` or they exist in dev and CI but not in the built image.
 */
export const metadataDir = resolvePackagePath('@sbordeyne/backstage-plugin-kubespec-backend', 'metadata');

const RESOURCE_SUMMARY_COLUMNS = [
  'api_group',
  'api_version',
  'api_version_full',
  'kind',
  'category',
  'scope',
  'description',
  'property_count',
  'has_metadata',
];

/** Widest table, used to size insert chunks. */
const RESOURCE_COLUMN_COUNT = 19;
const PROPERTY_COLUMN_COUNT = 11;
const CHANGE_COLUMN_COUNT = 10;

export class KubespecStore {
  private constructor(private readonly db: Knex) {}

  static async create(options: { database: DatabaseService }): Promise<KubespecStore> {
    const client = await options.database.getClient();
    if (!options.database.migrations?.skip) {
      await client.migrate.latest({ directory: migrationsDir });
    }
    return new KubespecStore(client);
  }

  /** Exposed for the migration smoke test. */
  get knex(): Knex {
    return this.db;
  }

  // --- sync path ---

  async upsertSource(source: SourceRecord): Promise<void> {
    const row = {
      slug: source.slug,
      name: source.name,
      kind: source.kind,
      repo: source.repo,
      logo_url: source.logoUrl ?? null,
      display_order: source.displayOrder,
    };

    const updated = await this.db('kubespec_sources').where('slug', source.slug).update(row);
    if (updated === 0) {
      await this.db('kubespec_sources').insert(row);
    }
  }

  async getSourceTagsEtag(slug: string): Promise<string | undefined> {
    const row = await this.db('kubespec_sources').select('tags_etag').where('slug', slug).first();
    return row?.tags_etag ?? undefined;
  }

  async recordSourceSync(slug: string, outcome: SourceSyncOutcome): Promise<void> {
    await this.db('kubespec_sources')
      .where('slug', slug)
      .update({
        last_synced_at: new Date(),
        last_sync_status: outcome.status,
        last_sync_error: outcome.error ?? null,
        // Only overwritten when the listing produced one: a 304 leaves the stored
        // ETag in place, which is the whole point of sending it.
        ...(outcome.tagsEtag ? { tags_etag: outcome.tagsEtag } : {}),
      });
  }

  /**
   * Marks every configured source to be re-read on the next sync, ignoring the
   * content hashes that would otherwise skip unchanged versions.
   */
  async requestForceResync(): Promise<number> {
    return this.db('kubespec_sources').update({ force_resync: true });
  }

  async isForceResyncRequested(slug: string): Promise<boolean> {
    const row = await this.db('kubespec_sources').select('force_resync').where('slug', slug).first();
    return Boolean(row?.force_resync);
  }

  /** Cleared per source, so an interrupted rebuild resumes rather than restarting. */
  async clearForceResync(slug: string): Promise<void> {
    await this.db('kubespec_sources').where('slug', slug).update({ force_resync: false });
  }

  async listStoredVersions(sourceSlug: string): Promise<StoredVersion[]> {
    const rows = await this.db('kubespec_versions')
      .select('id', 'version', 'upstream_ref', 'sort_key', 'content_hash', 'state', 'is_latest')
      .where('source_slug', sourceSlug)
      .orderBy('sort_key', 'asc');

    return rows.map(row => ({
      id: row.id,
      version: row.version,
      upstreamRef: row.upstream_ref,
      sortKey: row.sort_key,
      contentHash: row.content_hash,
      state: row.state,
      isLatest: Boolean(row.is_latest),
    }));
  }

  async listResourceKeys(versionId: string): Promise<ResourceKey[]> {
    const rows = await this.db('kubespec_resources')
      .select('api_group', 'api_version', 'kind')
      .where('version_id', versionId);

    return rows.map(row => ({ apiGroup: row.api_group, apiVersion: row.api_version, kind: row.kind }));
  }

  /** One resource's stored schema, for diffing the next version against it. */
  async getStoredDefinition(versionId: string, key: ResourceKey): Promise<StoredDefinition | undefined> {
    const row = await this.db('kubespec_resources')
      .select('id', 'api_group', 'api_version', 'kind', 'definition_gzip')
      .where({
        version_id: versionId,
        api_group: key.apiGroup,
        api_version: key.apiVersion,
        kind: key.kind,
      })
      .first();

    if (!row) {
      return undefined;
    }
    return {
      id: row.id,
      apiGroup: row.api_group,
      apiVersion: row.api_version,
      kind: row.kind,
      definitionGzip: toBuffer(row.definition_gzip),
    };
  }

  /**
   * Writes one version and everything hanging off it, atomically.
   *
   * Guarded twice over: the transaction gives atomicity, and the row only reaches
   * `state = 'ready'` at the very end, so a crash leaves a version that every read
   * path filters out rather than a half-populated one it serves.
   */
  async ingestVersion(input: IngestVersionInput): Promise<string> {
    const versionId = randomUUID();
    const now = new Date();

    await this.db.transaction(async trx => {
      // Re-ingesting a version replaces it wholesale; the FK cascade clears the
      // resources, properties, summaries and changes underneath.
      await trx('kubespec_versions')
        .where({ source_slug: input.version.sourceSlug, version: input.version.version })
        .del();

      await trx('kubespec_versions').insert({
        id: versionId,
        source_slug: input.version.sourceSlug,
        version: input.version.version,
        upstream_ref: input.version.upstreamRef,
        sort_key: input.version.sortKey,
        content_hash: input.version.contentHash,
        state: 'ingesting',
        is_latest: false,
        changes_stale: false,
        resource_count: input.resources.length,
        source_bytes: input.version.sourceBytes,
        ingested_at: now,
      });

      const propertyRows: Record<string, unknown>[] = [];
      const resourceRows = input.resources.map(resource => {
        const resourceId = randomUUID();
        for (const property of resource.properties) {
          propertyRows.push({
            resource_id: resourceId,
            seq: property.seq,
            path: property.path,
            path_lower: property.path.toLowerCase(),
            name: property.name,
            name_lower: property.name.toLowerCase(),
            type: property.type,
            is_array: property.isArray,
            required: property.required,
            depth: property.depth,
            description: property.description,
            description_lower: property.description.toLowerCase(),
          });
        }

        return {
          id: resourceId,
          version_id: versionId,
          api_group: resource.apiGroup,
          api_version: resource.apiVersion,
          api_version_full: resource.apiVersionFull,
          kind: resource.kind,
          kind_lower: resource.kind.toLowerCase(),
          api_group_lower: resource.apiGroup.toLowerCase(),
          category: resource.category,
          scope: resource.scope,
          description: resource.description,
          description_lower: resource.description.toLowerCase(),
          property_count: resource.propertyCount,
          tree_depth: resource.treeDepth,
          definition_gzip: resource.definitionGzip,
          definition_bytes: resource.definitionBytes,
          definition_hash: resource.definitionHash,
          truncated: resource.truncated,
          has_metadata: false,
        };
      });

      await this.insertChunked(trx, 'kubespec_resources', resourceRows, RESOURCE_COLUMN_COUNT);
      await this.insertChunked(trx, 'kubespec_properties', propertyRows, PROPERTY_COLUMN_COUNT);

      const changeRows: Record<string, unknown>[] = [];
      const summaryRows = input.summaries.map(summary => {
        const summaryId = randomUUID();
        summary.changes.forEach((change, seq) => {
          changeRows.push({
            id: randomUUID(),
            summary_id: summaryId,
            seq,
            change_type: change.changeType,
            path: change.path,
            path_count: change.pathCount,
            paths_json: change.paths ? JSON.stringify(change.paths) : null,
            depth: change.depth,
            description: change.description ?? null,
            previous_value: change.previousValue ?? null,
            next_value: change.nextValue ?? null,
            diff_json: change.diff ? JSON.stringify(change.diff) : null,
          });
        });

        return {
          id: summaryId,
          version_id: versionId,
          previous_version_id: summary.previousVersionId ?? null,
          api_group: summary.apiGroup,
          api_version: summary.apiVersion,
          kind: summary.kind,
          is_new_gvk: summary.isNewGvk,
          is_removed_gvk: summary.isRemovedGvk,
          added_count: summary.addedCount,
          removed_count: summary.removedCount,
          description_changed_count: summary.descriptionChangedCount,
          description_changed_paths: summary.descriptionChangedPaths,
          type_changed_count: summary.typeChangedCount,
          type_changed_paths: summary.typeChangedPaths,
        };
      });

      await this.insertChunked(trx, 'kubespec_change_summaries', summaryRows, 14);
      await this.insertChunked(trx, 'kubespec_changes', changeRows, CHANGE_COLUMN_COUNT);

      await trx('kubespec_versions').where('id', versionId).update({ state: 'ready' });
    });

    return versionId;
  }

  async markVersionFailed(sourceSlug: string, version: string, error: string): Promise<void> {
    await this.db('kubespec_versions')
      .where({ source_slug: sourceSlug, version })
      // The latest flag comes off with it. A version that was serving as latest
      // and then failed a later ingest would otherwise keep the flag while no
      // longer being readable, and every `latest` lookup for the source answers
      // 404 even though older versions are sitting there intact.
      .update({ state: 'failed', ingest_error: error, is_latest: false });
  }

  /** Marks a version's change list as computed against input that has since changed. */
  async markChangesStale(versionId: string): Promise<void> {
    await this.db('kubespec_versions').where('id', versionId).update({ changes_stale: true });
  }

  async setLatestVersion(sourceSlug: string, versionId: string): Promise<void> {
    await this.db.transaction(async trx => {
      await trx('kubespec_versions').where('source_slug', sourceSlug).update({ is_latest: false });
      await trx('kubespec_versions').where('id', versionId).update({ is_latest: true });
    });
  }

  /** Drops every version of a source except the ones named. Returns how many went. */
  async pruneVersions(sourceSlug: string, keepVersions: readonly string[]): Promise<number> {
    const query = this.db('kubespec_versions').where('source_slug', sourceSlug);
    if (keepVersions.length > 0) {
      query.whereNotIn('version', [...keepVersions]);
    }
    return query.del();
  }

  /**
   * Drops property-index rows for every version of a source but the one named.
   *
   * Under the default `search.scope: 'latest'` only the newest version is
   * searchable, so leaving the previous one's rows behind would grow the largest
   * table in the schema without ever being read.
   */
  async pruneProperties(sourceSlug: string, keepVersionId: string): Promise<number> {
    const staleResourceIds = this.db('kubespec_resources')
      .select('kubespec_resources.id')
      .join('kubespec_versions as v', 'v.id', 'kubespec_resources.version_id')
      .where('v.source_slug', sourceSlug)
      .andWhereNot('kubespec_resources.version_id', keepVersionId);

    return this.db('kubespec_properties').whereIn('resource_id', staleResourceIds).del();
  }

  async pruneSources(keepSlugs: readonly string[]): Promise<string[]> {
    const doomed: Array<{ slug: string }> = await this.db('kubespec_sources')
      .select('slug')
      .modify(query => {
        if (keepSlugs.length > 0) {
          query.whereNotIn('slug', [...keepSlugs]);
        }
      });

    const slugs = doomed.map(row => row.slug);
    if (slugs.length > 0) {
      await this.db('kubespec_sources').whereIn('slug', slugs).del();
    }
    return slugs;
  }

  async replaceMetadata(examples: readonly MetadataEntry[], links: readonly MetadataLinkEntry[]): Promise<void> {
    await this.db.transaction(async trx => {
      await trx('kubespec_examples').del();
      await trx('kubespec_links').del();

      await this.insertChunked(
        trx,
        'kubespec_examples',
        examples.map(example => ({
          id: randomUUID(),
          source_slug: example.sourceSlug,
          api_version_full: example.apiVersionFull,
          kind_lower: example.kindLower,
          slug: example.slug,
          ordinal: example.ordinal,
          title: example.title,
          description: example.description ?? null,
          content: example.content,
          content_hash: example.contentHash,
        })),
        9,
      );

      await this.insertChunked(
        trx,
        'kubespec_links',
        links.map(link => ({
          id: randomUUID(),
          source_slug: link.sourceSlug,
          api_version_full: link.apiVersionFull,
          kind_lower: link.kindLower,
          ordinal: link.ordinal,
          name: link.name,
          href: link.href,
        })),
        7,
      );
    });
  }

  /**
   * Recomputes the `has_metadata` flag on every resource.
   *
   * Denormalized so a list page can badge the kinds that have examples without a
   * correlated subquery per row.
   */
  async refreshHasMetadata(): Promise<void> {
    await this.db('kubespec_resources').update({ has_metadata: false });

    for (const table of ['kubespec_examples', 'kubespec_links']) {
      const keys = await this.db(table).distinct('source_slug', 'api_version_full', 'kind_lower').select();

      for (const key of keys) {
        const versionIds = this.db('kubespec_versions').select('id').where('source_slug', key.source_slug);
        await this.db('kubespec_resources')
          .whereIn('version_id', versionIds)
          .andWhere({ api_version_full: key.api_version_full, kind_lower: key.kind_lower })
          .update({ has_metadata: true });
      }
    }
  }

  private async insertChunked(
    trx: Knex.Transaction,
    table: string,
    rows: readonly Record<string, unknown>[],
    columnCount: number,
  ): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    for (const chunk of chunked(rows, chunkSizeFor(this.db.client.config.client, columnCount))) {
      await trx(table).insert(chunk);
    }
  }

  // --- read path ---

  async listSources(): Promise<KubespecSourceSummary[]> {
    const rows = await this.db('kubespec_sources as s')
      .select(
        's.slug',
        's.name',
        's.kind',
        's.repo',
        's.logo_url',
        's.last_synced_at',
        's.last_sync_status',
        this.db.raw(
          "(select count(*) from kubespec_versions v where v.source_slug = s.slug and v.state = 'ready') as version_count",
        ),
        this.db.raw(
          "(select v.version from kubespec_versions v where v.source_slug = s.slug and v.is_latest = ? and v.state = 'ready' limit 1) as latest_version",
          [true],
        ),
      )
      .orderBy([{ column: 's.display_order' }, { column: 's.name' }]);

    return rows.map(row => ({
      slug: row.slug,
      name: row.name,
      kind: row.kind,
      repo: row.repo,
      repoUrl: `https://github.com/${row.repo}`,
      logoUrl: row.logo_url ?? undefined,
      versionCount: Number(row.version_count ?? 0),
      latestVersion: row.latest_version ?? undefined,
      lastSyncedAt: row.last_synced_at ? toIsoString(row.last_synced_at) : undefined,
      lastSyncStatus: row.last_sync_status ?? undefined,
    }));
  }

  async listVersions(options: {
    sourceSlug: string;
    limit: number;
    cursor?: VersionCursor;
  }): Promise<KubespecPaginated<KubespecVersionSummary>> {
    const query = this.db('kubespec_versions')
      .select('id', 'version', 'upstream_ref', 'ingested_at', 'resource_count', 'is_latest', 'sort_key')
      .where({ source_slug: options.sourceSlug, state: 'ready' })
      .orderBy([
        { column: 'sort_key', order: 'desc' },
        { column: 'id', order: 'desc' },
      ])
      .limit(options.limit + 1);

    if (options.cursor) {
      const { k, id } = options.cursor;
      // Spelled out rather than as a row-value comparison, which SQLite lacks.
      query.where(builder => {
        builder.where('sort_key', '<', k).orWhere(inner => {
          inner.where('sort_key', k).andWhere('id', '<', id);
        });
      });
    }

    const rows = await query;
    const page = rows.slice(0, options.limit);
    const last = page[page.length - 1];

    return {
      items: page.map(row => ({
        version: row.version,
        upstreamRef: row.upstream_ref,
        ingestedAt: toIsoString(row.ingested_at),
        resourceCount: Number(row.resource_count),
        isLatest: Boolean(row.is_latest),
      })),
      nextCursor:
        rows.length > options.limit && last ? encodeVersionCursor({ k: last.sort_key, id: last.id }) : undefined,
    };
  }

  /**
   * Resolves a version name to a stored version.
   *
   * `latest` and an omitted version both mean "whatever the newest ingested
   * version is", which is what makes a shared link keep working after a sync.
   */
  async resolveVersion(
    sourceSlug: string,
    version?: string,
  ): Promise<{ id: string; version: string; sortKey: string; isLatest: boolean } | undefined> {
    const base = () =>
      this.db('kubespec_versions')
        .select('id', 'version', 'sort_key', 'is_latest')
        .where({ source_slug: sourceSlug, state: 'ready' });

    if (version && version !== 'latest') {
      const exact = await base().andWhere('version', version).first();
      return exact ? toResolvedVersion(exact) : undefined;
    }

    // Falls back to the newest readable version rather than trusting the flag
    // alone. The flag is set by a sync and can be left behind by one — pointing
    // at a version that a later run failed, or cleared entirely by a run that
    // was interrupted before it could move it. Neither is a reason to tell a
    // reader the source does not exist when perfectly good versions are stored.
    const row =
      (await base().andWhere('is_latest', true).first()) ?? (await base().orderBy('sort_key', 'desc').first());
    return row ? toResolvedVersion(row) : undefined;
  }

  /**
   * Every resource in a version.
   *
   * Not paginated on purpose: the largest source in the corpus has 83 kinds, and
   * without the schema blobs the whole list is well under 100 KB. Paginating it
   * would only stop the page filtering client-side, which is the fastest filter
   * available.
   */
  async listResources(versionId: string): Promise<KubespecResourceSummary[]> {
    const rows = await this.db('kubespec_resources')
      .select(RESOURCE_SUMMARY_COLUMNS)
      .where('version_id', versionId)
      .orderBy([{ column: 'category' }, { column: 'kind' }, { column: 'api_group' }]);

    return rows.map(toResourceSummary);
  }

  async getResource(
    versionId: string,
    key: ResourceKey,
  ): Promise<
    | (KubespecResourceSummary & {
        definitionGzip: Buffer;
        definitionBytes: number;
        definitionHash: string;
        truncated: boolean;
      })
    | undefined
  > {
    const row = await this.db('kubespec_resources')
      .select([...RESOURCE_SUMMARY_COLUMNS, 'definition_gzip', 'definition_bytes', 'definition_hash', 'truncated'])
      .where({
        version_id: versionId,
        api_group: key.apiGroup,
        api_version: key.apiVersion,
        kind: key.kind,
      })
      .first();

    if (!row) {
      return undefined;
    }

    return {
      ...toResourceSummary(row),
      definitionGzip: toBuffer(row.definition_gzip),
      definitionBytes: Number(row.definition_bytes),
      definitionHash: row.definition_hash,
      truncated: Boolean(row.truncated),
    };
  }

  /**
   * Change counters for one resource, from the given version back to the oldest.
   *
   * One query renders the entire change-history panel — the bodies are only
   * fetched when a reader opens an entry.
   */
  async listChangeSummaries(options: {
    sourceSlug: string;
    sortKey: string;
    key: ResourceKey;
  }): Promise<KubespecChangeSummary[]> {
    const rows = await this.db('kubespec_change_summaries as cs')
      .join('kubespec_versions as v', 'v.id', 'cs.version_id')
      .leftJoin('kubespec_versions as pv', 'pv.id', 'cs.previous_version_id')
      .select(
        'v.version as version',
        'pv.version as previous_version',
        'cs.is_new_gvk',
        'cs.is_removed_gvk',
        'cs.added_count',
        'cs.removed_count',
        'cs.description_changed_count',
        'cs.description_changed_paths',
        'cs.type_changed_count',
        'cs.type_changed_paths',
      )
      .where('v.source_slug', options.sourceSlug)
      .andWhere('v.state', 'ready')
      .andWhere('v.sort_key', '<=', options.sortKey)
      .andWhere({
        'cs.api_group': options.key.apiGroup,
        'cs.api_version': options.key.apiVersion,
        'cs.kind': options.key.kind,
      })
      .orderBy('v.sort_key', 'desc');

    return rows.map(row => ({
      version: row.version,
      previousVersion: row.previous_version ?? undefined,
      isNewGvk: Boolean(row.is_new_gvk),
      isRemovedGvk: Boolean(row.is_removed_gvk),
      addedCount: Number(row.added_count),
      removedCount: Number(row.removed_count),
      descriptionChangedCount: Number(row.description_changed_count),
      descriptionChangedPaths: Number(row.description_changed_paths),
      typeChangedCount: Number(row.type_changed_count),
      typeChangedPaths: Number(row.type_changed_paths),
    }));
  }

  async listChanges(options: {
    versionId: string;
    key: ResourceKey;
    changeType?: KubespecChangeType;
    limit: number;
    cursor?: number;
  }): Promise<KubespecPaginated<KubespecChange>> {
    const summary = await this.db('kubespec_change_summaries')
      .select('id')
      .where({
        version_id: options.versionId,
        api_group: options.key.apiGroup,
        api_version: options.key.apiVersion,
        kind: options.key.kind,
      })
      .first();

    if (!summary) {
      return { items: [] };
    }

    const query = this.db('kubespec_changes')
      .select(
        'seq',
        'change_type',
        'path',
        'path_count',
        'paths_json',
        'depth',
        'description',
        'previous_value',
        'next_value',
        'diff_json',
      )
      .where('summary_id', summary.id)
      .orderBy('seq', 'asc')
      .limit(options.limit + 1);

    if (options.cursor !== undefined) {
      query.andWhere('seq', '>', options.cursor);
    }
    if (options.changeType) {
      query.andWhere('change_type', options.changeType);
    }

    const rows = await query;
    const page = rows.slice(0, options.limit);
    const last = page[page.length - 1];

    return {
      items: page.map(toChange),
      nextCursor: rows.length > options.limit && last ? encodeChangeCursor(Number(last.seq)) : undefined,
    };
  }

  async searchResources(options: {
    needle: string;
    sourceSlug?: string;
    versionId?: string;
    limit: number;
    cursor?: Extract<SearchCursor, { t: 'r' }>;
  }): Promise<{ items: KubespecResourceHit[]; nextCursor?: string }> {
    const rank = this.rankExpression(options.needle);
    const like = likeArgument(options.needle);

    const query = this.db('kubespec_resources as r')
      .join('kubespec_versions as v', 'v.id', 'r.version_id')
      .join('kubespec_sources as s', 's.slug', 'v.source_slug')
      .select(
        'r.id',
        'r.api_group',
        'r.api_version',
        'r.api_version_full',
        'r.kind',
        'r.kind_lower',
        'r.category',
        'r.scope',
        'r.description',
        'v.version as source_version',
        's.slug as source_slug',
        's.name as source_name',
        this.db.raw(`${rank.sql} as rank`, rank.bindings),
      )
      .where('v.state', 'ready')
      .andWhere(builder => {
        builder
          .whereRaw("r.kind_lower like ? escape '\\'", [like])
          .orWhereRaw("r.api_group_lower like ? escape '\\'", [like])
          .orWhereRaw("r.description_lower like ? escape '\\'", [like]);
      })
      .orderByRaw(`${rank.sql} asc, r.kind_lower asc, r.id asc`, rank.bindings)
      .limit(options.limit + 1);

    if (options.versionId) {
      query.andWhere('r.version_id', options.versionId);
    } else if (options.sourceSlug) {
      query.andWhere('v.source_slug', options.sourceSlug);
    } else {
      // Without a source, a cross-source search only looks at each source's newest
      // version: the same kind repeated once per stored version is noise, not recall.
      query.andWhere('v.is_latest', true);
    }

    if (options.cursor) {
      const { rank: cursorRank, kind, id } = options.cursor;
      query.andWhere(builder => {
        builder
          .whereRaw(`${rank.sql} > ?`, [...rank.bindings, cursorRank])
          .orWhere(inner =>
            inner.whereRaw(`${rank.sql} = ?`, [...rank.bindings, cursorRank]).andWhere('r.kind_lower', '>', kind),
          )
          .orWhere(inner =>
            inner
              .whereRaw(`${rank.sql} = ?`, [...rank.bindings, cursorRank])
              .andWhere('r.kind_lower', kind)
              .andWhere('r.id', '>', id),
          );
      });
    }

    const rows = await query;
    const page = rows.slice(0, options.limit);
    const last = page[page.length - 1];

    return {
      items: page.map(row => ({
        sourceSlug: row.source_slug,
        sourceName: row.source_name,
        sourceVersion: row.source_version,
        group: row.api_group,
        apiVersion: row.api_version,
        apiVersionFull: row.api_version_full,
        kind: row.kind,
        category: row.category,
        scope: row.scope,
        description: row.description ?? '',
      })),
      nextCursor:
        rows.length > options.limit && last
          ? encodeSearchCursor({ t: 'r', rank: Number(last.rank), kind: last.kind_lower, id: last.id })
          : undefined,
    };
  }

  async searchProperties(options: {
    needle: string;
    versionId: string;
    limit: number;
    cursor?: Extract<SearchCursor, { t: 'p' }>;
  }): Promise<{ items: KubespecPropertyHit[]; nextCursor?: string }> {
    const like = likeArgument(options.needle);

    const query = this.db('kubespec_properties as p')
      .join('kubespec_resources as r', 'r.id', 'p.resource_id')
      .join('kubespec_versions as v', 'v.id', 'r.version_id')
      .select(
        'p.path',
        'p.type',
        'p.is_array',
        'p.required',
        'p.description',
        'p.depth',
        'p.seq',
        'r.id as resource_id',
        'r.api_group',
        'r.api_version',
        'r.api_version_full',
        'r.kind',
        'r.kind_lower',
        'v.version as source_version',
        'v.source_slug',
      )
      .where('r.version_id', options.versionId)
      .andWhere(builder => {
        builder
          .whereRaw("p.name_lower like ? escape '\\'", [like])
          .orWhereRaw("p.path_lower like ? escape '\\'", [like]);
      })
      .orderBy([{ column: 'p.depth' }, { column: 'r.kind_lower' }, { column: 'r.id' }, { column: 'p.seq' }])
      .limit(options.limit + 1);

    if (options.cursor) {
      const { depth, kind, rid, seq } = options.cursor;
      query.andWhere(builder => {
        builder
          .where('p.depth', '>', depth)
          .orWhere(inner => inner.where('p.depth', depth).andWhere('r.kind_lower', '>', kind))
          .orWhere(inner => inner.where('p.depth', depth).andWhere('r.kind_lower', kind).andWhere('r.id', '>', rid))
          .orWhere(inner =>
            inner
              .where('p.depth', depth)
              .andWhere('r.kind_lower', kind)
              .andWhere('r.id', rid)
              .andWhere('p.seq', '>', seq),
          );
      });
    }

    const rows = await query;
    const page = rows.slice(0, options.limit);
    const last = page[page.length - 1];

    return {
      items: page.map(row => ({
        sourceSlug: row.source_slug,
        sourceVersion: row.source_version,
        group: row.api_group,
        apiVersion: row.api_version,
        apiVersionFull: row.api_version_full,
        kind: row.kind,
        path: row.path,
        type: row.type,
        isArray: Boolean(row.is_array),
        required: Boolean(row.required),
        description: row.description ?? '',
      })),
      nextCursor:
        rows.length > options.limit && last
          ? encodeSearchCursor({
              t: 'p',
              depth: Number(last.depth),
              kind: last.kind_lower,
              rid: last.resource_id,
              seq: Number(last.seq),
            })
          : undefined,
    };
  }

  async getMetadata(sourceSlug: string, apiVersionFull: string, kind: string): Promise<KubespecMetadata> {
    const where = {
      source_slug: sourceSlug,
      api_version_full: apiVersionFull,
      kind_lower: kind.toLowerCase(),
    };

    const [exampleRows, linkRows] = await Promise.all([
      this.db('kubespec_examples')
        .select('slug', 'ordinal', 'title', 'description', 'content')
        .where(where)
        .orderBy([{ column: 'ordinal' }, { column: 'slug' }]),
      this.db('kubespec_links').select('name', 'href').where(where).orderBy('ordinal'),
    ]);

    const examples: KubespecExample[] = exampleRows.map(row => ({
      slug: row.slug,
      ordinal: Number(row.ordinal),
      title: row.title,
      description: row.description ?? undefined,
      content: row.content,
    }));

    const links: KubespecLink[] = linkRows.map(row => ({ name: row.name, href: row.href }));

    return { examples, links };
  }

  /**
   * Ranks a search hit: exact kind, then kind prefix, then kind substring, then
   * everything matched only by its group or description.
   *
   * A plain integer `case` rather than a scoring function, because no ranking
   * primitive is shared by SQLite and Postgres. Returned as SQL plus bindings
   * because the same expression has to appear in the select list, the order and
   * the keyset predicate — an alias cannot be referenced from a WHERE clause.
   */
  private rankExpression(needle: string): { sql: string; bindings: string[] } {
    const lowered = needle.toLowerCase();
    return {
      sql: "(case when r.kind_lower = ? then 0 when r.kind_lower like ? escape '\\' then 1 when r.kind_lower like ? escape '\\' then 2 else 3 end)",
      bindings: [lowered, `${escapeLike(lowered)}%`, likeArgument(needle)],
    };
  }
}

// --- row mapping ---

function toResolvedVersion(row: Record<string, any>): {
  id: string;
  version: string;
  sortKey: string;
  isLatest: boolean;
} {
  return { id: row.id, version: row.version, sortKey: row.sort_key, isLatest: Boolean(row.is_latest) };
}

function toResourceSummary(row: Record<string, any>): KubespecResourceSummary {
  return {
    group: row.api_group,
    apiVersion: row.api_version,
    apiVersionFull: row.api_version_full,
    kind: row.kind,
    category: row.category,
    scope: row.scope,
    description: row.description ?? '',
    propertyCount: Number(row.property_count),
    hasMetadata: Boolean(row.has_metadata),
  };
}

function toChange(row: Record<string, any>): KubespecChange {
  return {
    changeType: row.change_type,
    path: row.path,
    pathCount: Number(row.path_count),
    paths: row.paths_json ? JSON.parse(row.paths_json) : undefined,
    depth: Number(row.depth),
    description: row.description ?? undefined,
    previousValue: row.previous_value ?? undefined,
    nextValue: row.next_value ?? undefined,
    diff: row.diff_json ? JSON.parse(row.diff_json) : undefined,
  };
}

/**
 * `bytea` comes back as a Buffer on postgres and better-sqlite3 alike, but the
 * plain sqlite3 driver can hand back a Uint8Array view instead.
 */
function toBuffer(value: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

/**
 * `%` and `_` are wildcards and `\` is the escape character, so a needle
 * containing any of them has to be escaped or it silently matches too much.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, character => `\\${character}`);
}

function likeArgument(needle: string): string {
  return `%${escapeLike(needle.toLowerCase())}%`;
}
