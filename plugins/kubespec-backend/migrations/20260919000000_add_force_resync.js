// @ts-check

/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('kubespec_sources', table => {
    // Set by an operator asking for a rebuild from the page. The sync clears it
    // per source once that source has been re-read, so an interrupted run
    // resumes the rebuild rather than forgetting it was asked for.
    table.boolean('force_resync').notNullable().defaultTo(false);
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.alterTable('kubespec_sources', table => {
    table.dropColumn('force_resync');
  });
};
