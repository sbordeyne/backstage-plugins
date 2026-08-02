// @ts-check

/**
 * Reports can now come from GCS, S3 or GitHub Actions artifacts, so the columns naming the origin
 * stop pretending everything is a GCS object. Existing rows are all GCS, which is what the
 * `source_type` backfill says.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('bruno_runs', table => {
    table.renameColumn('gcs_bucket', 'artifact_source');
    table.renameColumn('gcs_object', 'artifact_path');
    table.renameColumn('gcs_generation', 'artifact_version');
    table.renameColumn('gcs_etag', 'artifact_etag');
    table.renameColumn('gcs_size_bytes', 'artifact_size_bytes');
  });

  await knex.schema.alterTable('bruno_runs', table => {
    table.string('source_type', 16).notNullable().defaultTo('gcs');
    // Was sized for a bare bucket name; it now holds a scheme-qualified
    // container, and an S3 multipart ETag is longer than a GCS generation.
    table.string('artifact_source', 255).notNullable().alter();
    table.string('artifact_version', 64).notNullable().alter();
  });

  // The bucket name was stored bare; the container is now qualified by scheme so
  // an S3 and a GCS bucket of the same name stay distinct.
  await knex('bruno_runs')
    .whereNot('artifact_source', 'like', 'gs://%')
    .update({ artifact_source: knex.raw("'gs://' || ??", ['artifact_source']) });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex('bruno_runs')
    .where('artifact_source', 'like', 'gs://%')
    .update({ artifact_source: knex.raw('substr(??, 6)', ['artifact_source']) });

  await knex.schema.alterTable('bruno_runs', table => {
    table.dropColumn('source_type');
  });

  await knex.schema.alterTable('bruno_runs', table => {
    table.renameColumn('artifact_source', 'gcs_bucket');
    table.renameColumn('artifact_path', 'gcs_object');
    table.renameColumn('artifact_version', 'gcs_generation');
    table.renameColumn('artifact_etag', 'gcs_etag');
    table.renameColumn('artifact_size_bytes', 'gcs_size_bytes');
  });
};
