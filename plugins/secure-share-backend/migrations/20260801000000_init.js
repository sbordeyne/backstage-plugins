// @ts-check

/**
 * Initial schema for the secure-share plugin.
 *
 * Nothing stored here is readable by the backend: payload chunks live in the blob
 * store as ciphertext, data keys are only ever stored wrapped to a recipient device
 * public key, and paste metadata (title, filename, mime type) is a sealed blob.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('secure_share_device_keys', table => {
    table.comment('ECDH P-256 public keys enrolled by a single browser of a single user');
    table.uuid('id').primary().notNullable();
    table.text('user_entity_ref').notNullable().index();
    table.text('public_key').notNullable().comment('JWK of the P-256 public key');
    table.text('fingerprint').notNullable().comment('RFC 7638 JWK thumbprint, base64url encoded');
    table.text('label').notNullable().comment('Human readable device name chosen at enrollment');
    table.dateTime('created_at').notNullable();
    table.dateTime('last_used_at').nullable();
    table.dateTime('revoked_at').nullable();
    table.unique(['user_entity_ref', 'fingerprint'], {
      indexName: 'secure_share_device_keys_user_fingerprint_uniq',
    });
  });

  await knex.schema.createTable('secure_share_pastes', table => {
    table.comment('Metadata of an encrypted paste; contains no plaintext and no key material');
    table.text('id').primary().notNullable();
    table.text('created_by_entity_ref').notNullable().index();
    table.text('kind').notNullable().comment('text or file');
    table.text('meta_ciphertext').notNullable().comment('Sealed title, filename, mime type and language');
    table.integer('chunk_count').notNullable();
    table.bigInteger('size_bytes').notNullable().comment('Total ciphertext size, used to enforce limits');
    table.text('storage_key').notNullable().comment('Prefix of the ciphertext chunks in the blob store');
    table.dateTime('expires_at').notNullable().index();
    table.boolean('burn_after_read').notNullable().defaultTo(false);
    table.integer('max_reads').nullable();
    table.integer('read_count').notNullable().defaultTo(0);
    table.text('link_token_hash').nullable().comment('SHA-256 of the secret link token, when link sharing is on');
    table.dateTime('created_at').notNullable();
    table.dateTime('finalized_at').nullable().comment('Set once every chunk is uploaded; reads are refused before');
    table.dateTime('consumed_at').nullable().comment('First read of a burn-after-read paste, starts the grace period');
  });

  await knex.schema.createTable('secure_share_paste_recipients', table => {
    table.comment('Entity refs a paste was shared with, as requested by the sender');
    table.text('paste_id').notNullable().references('id').inTable('secure_share_pastes').onDelete('CASCADE');
    table.text('recipient_entity_ref').notNullable().comment('A user: or group: ref');
    table.primary(['paste_id', 'recipient_entity_ref']);
  });

  await knex.schema.createTable('secure_share_wrapped_keys', table => {
    table.comment('Paste data key, wrapped to one recipient device public key');
    table.text('paste_id').notNullable().references('id').inTable('secure_share_pastes').onDelete('CASCADE');
    table.uuid('device_key_id').notNullable().references('id').inTable('secure_share_device_keys').onDelete('CASCADE');
    table
      .text('user_entity_ref')
      .notNullable()
      .index()
      .comment('Owner of the device key, denormalized so the homepage card is a single indexed lookup');
    table.text('ephemeral_public_key').notNullable().comment('JWK of the sender ephemeral key used for the ECDH');
    table.text('wrapped_key').notNullable().comment('AES-GCM wrapped data key, base64 encoded iv and ciphertext');
    table.primary(['paste_id', 'device_key_id']);
  });

  await knex.schema.createTable('secure_share_reads', table => {
    table.comment('Audit trail of paste reads; deliberately has no foreign key so it outlives the paste');
    table.increments('id').primary();
    table.text('paste_id').notNullable().index();
    table.text('reader_entity_ref').nullable().comment('Null for reads through a secret link');
    table.uuid('device_key_id').nullable();
    table.text('via').notNullable().comment('recipient or link');
    table.dateTime('read_at').notNullable();
  });
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('secure_share_reads');
  await knex.schema.dropTableIfExists('secure_share_wrapped_keys');
  await knex.schema.dropTableIfExists('secure_share_paste_recipients');
  await knex.schema.dropTableIfExists('secure_share_pastes');
  await knex.schema.dropTableIfExists('secure_share_device_keys');
};
