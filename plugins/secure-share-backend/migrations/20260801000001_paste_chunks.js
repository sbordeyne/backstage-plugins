// @ts-check

/**
 * Records which ciphertext chunks of a paste have actually been uploaded, so that
 * finalizing a paste can refuse to seal an incomplete payload instead of trusting the
 * client's word for it.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('secure_share_paste_chunks', table => {
    table.comment('One row per uploaded ciphertext chunk');
    table.text('paste_id').notNullable().references('id').inTable('secure_share_pastes').onDelete('CASCADE');
    table.integer('chunk_index').notNullable();
    table.integer('size_bytes').notNullable();
    table.dateTime('uploaded_at').notNullable();
    table.primary(['paste_id', 'chunk_index']);
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('secure_share_paste_chunks');
};
