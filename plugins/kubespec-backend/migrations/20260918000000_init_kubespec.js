// @ts-check

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('kubespec_sources', table => {
    table.comment('One configured spec source. Config is the source of truth; this table only carries bookkeeping.');

    table.string('slug', 64).primary().notNullable();
    table.string('name', 128).notNullable();
    // 'kubernetes' | 'crd'. Decides which normalizer ran, which the read path
    // needs in order to order categories.
    table.string('kind', 16).notNullable();
    table.string('repo', 128).notNullable();
    table.text('logo_url').nullable();
    table.integer('display_order').notNullable().defaultTo(0);

    table.dateTime('last_synced_at').nullable();
    table.string('last_sync_status', 16).nullable();
    table.text('last_sync_error').nullable();
    // ETag of the tag listing. A 304 on the next tick costs no rate-limit quota,
    // which is what keeps a daily sync of ~28 repos free.
    table.string('tags_etag', 128).nullable();
  });

  await knex.schema.createTable('kubespec_versions', table => {
    table.comment('One ingested version of a source. Only rows in state=ready are ever read.');

    table.string('id', 36).primary().notNullable();
    table.string('source_slug', 64).notNullable();
    // The displayed version, after any tag prefix has been stripped.
    table.string('version', 64).notNullable();
    // The real git tag, which may carry a prefix: 'vertical-pod-autoscaler-chart-1.2.3'.
    table.string('upstream_ref', 255).notNullable();
    // Fixed-width and string-sortable, computed once at ingest so that ordering
    // versions never needs semver semantics in SQL.
    table.string('sort_key', 64).notNullable();
    // sha256 over the sorted (path, git blob sha) pairs. Computed from the
    // directory listing alone, so an unchanged version is skipped without
    // downloading a single file.
    table.string('content_hash', 64).notNullable();

    // 'ingesting' | 'ready' | 'failed'. The atomicity guard: ingest flips to
    // 'ready' last, and every read path filters on it, so a crashed run leaves
    // nothing half-visible even on a dialect that fails mid-transaction.
    table.string('state', 16).notNullable().defaultTo('ingesting');
    table.boolean('is_latest').notNullable().defaultTo(false);
    // Set when the version before this one was re-ingested, so this one's diff
    // is now computed against stale input.
    table.boolean('changes_stale').notNullable().defaultTo(true);

    table.integer('resource_count').notNullable().defaultTo(0);
    table.integer('source_bytes').notNullable().defaultTo(0);
    table.dateTime('ingested_at').notNullable();
    table.text('ingest_error').nullable();

    table
      .foreign('source_slug', 'kubespec_versions_source_fk')
      .references('slug')
      .inTable('kubespec_sources')
      .onDelete('CASCADE');

    table.unique(['source_slug', 'version'], { indexName: 'kubespec_versions_source_version_uniq' });
    table.index(['source_slug', 'state', 'sort_key'], 'kubespec_versions_source_state_sort_idx');
    table.index(['is_latest'], 'kubespec_versions_latest_idx');
  });

  await knex.schema.createTable('kubespec_resources', table => {
    table.comment('One GVK within a version, after collapsing each kind to its most mature API version.');

    table.string('id', 36).primary().notNullable();
    table.string('version_id', 36).notNullable();

    // Named api_group rather than group: `group` is a SQL keyword, and relying on
    // every dialect to quote it correctly in every query is a needless bet.
    // 253 is the DNS subdomain limit an API group is bound by.
    table.string('api_group', 253).notNullable().defaultTo('');
    table.string('api_version', 64).notNullable();
    // 'apps/v1', or just 'v1' for the core group.
    table.string('api_version_full', 320).notNullable();
    table.string('kind', 128).notNullable();

    // Lowercased copies: SQLite's LIKE is case-insensitive for ASCII and
    // Postgres' is not, so search compares a lowercased needle against these and
    // the two dialects agree.
    table.string('kind_lower', 128).notNullable();
    table.string('api_group_lower', 253).notNullable();

    table.string('category', 64).notNullable();
    table.string('scope', 16).notNullable();
    table.text('description').nullable();
    table.text('description_lower').nullable();

    table.integer('property_count').notNullable().defaultTo(0);
    table.integer('tree_depth').notNullable().defaultTo(0);

    // The fully expanded schema, gzipped at ingest. These are the wire bytes: the
    // router streams them out under Content-Encoding: gzip, so serving a schema
    // costs no CPU. Stored as binary rather than text because bytea and blob both
    // round-trip a Buffer, whereas knex's json() parses on postgres only.
    // See docs/adr/04-adr-kubespec-storage.md.
    table.binary('definition_gzip').notNullable();
    table.integer('definition_bytes').notNullable();
    // sha256 of the uncompressed JSON, served as the ETag.
    table.string('definition_hash', 64).notNullable();
    table.boolean('truncated').notNullable().defaultTo(false);
    table.boolean('has_metadata').notNullable().defaultTo(false);

    table
      .foreign('version_id', 'kubespec_resources_version_fk')
      .references('id')
      .inTable('kubespec_versions')
      .onDelete('CASCADE');

    table.unique(['version_id', 'api_group', 'api_version', 'kind'], { indexName: 'kubespec_resources_gvk_uniq' });
    table.index(['version_id', 'category', 'kind'], 'kubespec_resources_version_category_idx');
    table.index(['kind_lower'], 'kubespec_resources_kind_lower_idx');
  });

  await knex.schema.createTable('kubespec_properties', table => {
    table.comment('Flat property index, used only for search. The tree is rendered from the resource blob.');

    table.string('resource_id', 36).notNullable();
    // Stable ordinal within the resource, in document order; doubles as the cursor.
    table.integer('seq').notNullable();

    table.text('path').notNullable();
    table.text('path_lower').notNullable();
    table.string('name', 255).notNullable();
    table.string('name_lower', 255).notNullable();
    table.string('type', 128).notNullable();
    table.boolean('is_array').notNullable().defaultTo(false);
    table.boolean('required').notNullable().defaultTo(false);
    table.integer('depth').notNullable();
    table.text('description').nullable();
    table.text('description_lower').nullable();

    table
      .foreign('resource_id', 'kubespec_properties_resource_fk')
      .references('id')
      .inTable('kubespec_resources')
      .onDelete('CASCADE');

    // Composite primary key: (resource_id, seq) is already unique, so a UUID
    // column would be dead weight on the largest table in the schema.
    table.primary(['resource_id', 'seq']);
    table.index(['name_lower'], 'kubespec_properties_name_lower_idx');
    table.index(['resource_id', 'depth', 'seq'], 'kubespec_properties_resource_depth_idx');
  });

  await knex.schema.createTable('kubespec_change_summaries', table => {
    table.comment('Per (version, GVK) change counters. One query renders the whole change history panel.');

    table.string('id', 36).primary().notNullable();
    table.string('version_id', 36).notNullable();
    // Null on the oldest ingested version of a source.
    table.string('previous_version_id', 36).nullable();

    table.string('api_group', 253).notNullable().defaultTo('');
    table.string('api_version', 64).notNullable();
    table.string('kind', 128).notNullable();

    table.boolean('is_new_gvk').notNullable().defaultTo(false);
    table.boolean('is_removed_gvk').notNullable().defaultTo(false);

    table.integer('added_count').notNullable().defaultTo(0);
    table.integer('removed_count').notNullable().defaultTo(0);
    // Distinct edits and the paths they touch are counted separately: one edit to
    // a shared type's doc comment surfaces at every path embedding it, and
    // reporting only the path count turns one change into a thousand.
    table.integer('description_changed_count').notNullable().defaultTo(0);
    table.integer('description_changed_paths').notNullable().defaultTo(0);
    table.integer('type_changed_count').notNullable().defaultTo(0);
    table.integer('type_changed_paths').notNullable().defaultTo(0);

    table
      .foreign('version_id', 'kubespec_change_summaries_version_fk')
      .references('id')
      .inTable('kubespec_versions')
      .onDelete('CASCADE');

    table.unique(['version_id', 'api_group', 'api_version', 'kind'], {
      indexName: 'kubespec_change_summaries_gvk_uniq',
    });
  });

  await knex.schema.createTable('kubespec_changes', table => {
    table.comment('The change list for one (version, GVK), deduplicated by distinct edit.');

    table.string('id', 36).primary().notNullable();
    table.string('summary_id', 36).notNullable();
    table.integer('seq').notNullable();

    // 'new' | 'removed' | 'description' | 'type'
    table.string('change_type', 16).notNullable();
    table.text('path').notNullable();
    table.integer('path_count').notNullable().defaultTo(1);
    // Only set when path_count > 1, and capped, so it can be shorter than the
    // count. JSON as text with explicit stringify/parse: knex's json() maps to a
    // parsed object on postgres but a raw string on sqlite.
    table.text('paths_json').nullable();
    table.integer('depth').notNullable();

    table.text('description').nullable();
    table.text('previous_value').nullable();
    table.text('next_value').nullable();
    // Precomputed word-level diff of previous_value -> next_value. A constant,
    // computed once here rather than once per reader in the browser.
    table.text('diff_json').nullable();

    table
      .foreign('summary_id', 'kubespec_changes_summary_fk')
      .references('id')
      .inTable('kubespec_change_summaries')
      .onDelete('CASCADE');

    table.unique(['summary_id', 'seq'], { indexName: 'kubespec_changes_summary_seq_uniq' });
    table.index(['summary_id', 'change_type', 'seq'], 'kubespec_changes_type_idx');
  });

  await knex.schema.createTable('kubespec_examples', table => {
    table.comment('Hand-authored YAML examples, parsed from the packaged metadata directory. Version-independent.');

    table.string('id', 36).primary().notNullable();
    table.string('source_slug', 64).notNullable();
    table.string('api_version_full', 320).notNullable();
    table.string('kind_lower', 128).notNullable();
    table.string('slug', 128).notNullable();
    // The leading ordinal in the filename ('1-pod.md'), which is how the author
    // orders the accordion.
    table.integer('ordinal').notNullable().defaultTo(0);

    table.string('title', 512).notNullable();
    table.text('description').nullable();
    table.text('content').notNullable();
    table.string('content_hash', 64).notNullable();

    table.unique(['source_slug', 'api_version_full', 'kind_lower', 'slug'], {
      indexName: 'kubespec_examples_gvk_slug_uniq',
    });
    table.index(['source_slug', 'api_version_full', 'kind_lower', 'ordinal'], 'kubespec_examples_gvk_idx');
  });

  await knex.schema.createTable('kubespec_links', table => {
    table.comment('Hand-authored external documentation links per kind. Version-independent.');

    table.string('id', 36).primary().notNullable();
    table.string('source_slug', 64).notNullable();
    table.string('api_version_full', 320).notNullable();
    table.string('kind_lower', 128).notNullable();
    table.integer('ordinal').notNullable().defaultTo(0);

    table.string('name', 255).notNullable();
    table.text('href').notNullable();

    table.unique(['source_slug', 'api_version_full', 'kind_lower', 'ordinal'], {
      indexName: 'kubespec_links_gvk_ordinal_uniq',
    });
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('kubespec_links');
  await knex.schema.dropTableIfExists('kubespec_examples');
  await knex.schema.dropTableIfExists('kubespec_changes');
  await knex.schema.dropTableIfExists('kubespec_change_summaries');
  await knex.schema.dropTableIfExists('kubespec_properties');
  await knex.schema.dropTableIfExists('kubespec_resources');
  await knex.schema.dropTableIfExists('kubespec_versions');
  await knex.schema.dropTableIfExists('kubespec_sources');
};
