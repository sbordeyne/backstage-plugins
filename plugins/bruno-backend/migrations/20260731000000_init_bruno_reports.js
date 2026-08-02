// @ts-check

/**
 * Columns mirroring BrunoReportSummary. Kept as explicit integers rather than a
 * JSON blob so the summary stays queryable and sortable.
 */
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
];

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('bruno_runs', table => {
    table.comment('One synced Bruno report artifact, scoped to the entity that owns it.');

    // UUIDs are generated in Node: gen_random_uuid() does not exist on SQLite.
    table.string('id', 36).primary().notNullable();
    // sha256 of bucket + object + generation + entity_ref. Indexed instead of
    // gcs_object because GCS object names run to 1024 bytes.
    table.string('run_key', 64).notNullable();
    table.string('entity_ref', 255).notNullable();
    table.string('report_name', 255).notNullable();

    table.string('gcs_bucket', 222).notNullable();
    table.text('gcs_object').notNullable();
    table.string('gcs_generation', 32).notNullable();
    table.string('gcs_etag', 128).nullable();
    // int4, not bigint: the pg driver returns int8 as a string, and artifacts
    // are far below 2 GiB.
    table.integer('gcs_size_bytes').nullable();

    table.dateTime('artifact_created_at', { precision: 0 }).notNullable();
    table.dateTime('synced_at', { precision: 0 }).notNullable().defaultTo(knex.fn.now());

    table.integer('iteration_count').notNullable().defaultTo(1);
    table.integer('results_count').notNullable().defaultTo(0);
    table.string('status', 16).notNullable().defaultTo('pass');

    for (const column of SUMMARY_COLUMNS) {
      table.integer(column).notNullable().defaultTo(0);
    }

    table.unique(['run_key'], { indexName: 'bruno_runs_run_key_uniq' });
    table.index(['entity_ref', 'artifact_created_at', 'id'], 'bruno_runs_entity_created_idx');
    table.index(['report_name'], 'bruno_runs_report_name_idx');
  });

  await knex.schema.createTable('bruno_run_results', table => {
    table.comment('One request result within a run. Narrow by design: this is the list/pagination row.');

    table.string('id', 36).primary().notNullable();
    table.string('run_id', 36).notNullable();
    // 0-based ordinal across every iteration of the run; doubles as the cursor.
    table.integer('seq').notNullable();
    table.integer('iteration_index').notNullable().defaultTo(0);

    table.string('name', 512).nullable();
    table.text('path').nullable();
    table.text('test_filename').nullable();
    table.string('status', 16).notNullable();

    table.string('request_method', 10).nullable();
    table.text('request_url').nullable();
    table.integer('response_status').nullable();
    table.string('response_status_text', 255).nullable();
    table.integer('response_time_ms').nullable();
    table.integer('run_duration_ms').nullable();
    table.text('error').nullable();

    table.integer('assertions_total').notNullable().defaultTo(0);
    table.integer('assertions_passed').notNullable().defaultTo(0);
    table.integer('tests_total').notNullable().defaultTo(0);
    table.integer('tests_passed').notNullable().defaultTo(0);

    table.foreign('run_id', 'bruno_run_results_run_id_fk').references('id').inTable('bruno_runs').onDelete('CASCADE');

    table.unique(['run_id', 'seq'], { indexName: 'bruno_run_results_run_seq_uniq' });
    table.index(['run_id', 'status'], 'bruno_run_results_run_status_idx');
  });

  await knex.schema.createTable('bruno_run_result_details', table => {
    table.comment('Heavy 1:1 payload for a result. Only read when a row is expanded.');

    table.string('result_id', 36).primary().notNullable();
    // Denormalized so details can be pruned by run without a join.
    table.string('run_id', 36).notNullable();

    // JSON is stored as text and (de)serialized explicitly: knex's json() maps to
    // a parsed object on postgres but a raw string on sqlite.
    table.text('request_headers_json').nullable();
    table.text('request_body').nullable();
    table.text('response_headers_json').nullable();
    table.text('response_body').nullable();
    table.boolean('response_body_truncated').notNullable().defaultTo(false);

    table.text('assertion_results_json').nullable();
    table.text('test_results_json').nullable();
    table.text('pre_request_test_results_json').nullable();
    table.text('post_response_test_results_json').nullable();

    table
      .foreign('result_id', 'bruno_run_result_details_result_id_fk')
      .references('id')
      .inTable('bruno_run_results')
      .onDelete('CASCADE');

    table.index(['run_id'], 'bruno_run_result_details_run_idx');
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('bruno_run_result_details');
  await knex.schema.dropTableIfExists('bruno_run_results');
  await knex.schema.dropTableIfExists('bruno_runs');
};
