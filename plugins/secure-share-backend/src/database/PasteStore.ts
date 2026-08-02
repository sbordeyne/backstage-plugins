import { EcdhPublicKeyJwk, PasteKind, PasteReadEntry, WrappedKey } from '@sbordeyne/secure-share-common';
import { Knex } from 'knex';

const PASTES = 'secure_share_pastes';
const RECIPIENTS = 'secure_share_paste_recipients';
const WRAPPED_KEYS = 'secure_share_wrapped_keys';
const CHUNKS = 'secure_share_paste_chunks';
const READS = 'secure_share_reads';

interface PasteRow {
  id: string;
  created_by_entity_ref: string;
  kind: string;
  meta_ciphertext: string;
  chunk_count: number;
  size_bytes: number | string;
  storage_key: string;
  expires_at: Date | string;
  burn_after_read: boolean | number;
  max_reads: number | null;
  read_count: number;
  link_token_hash: string | null;
  created_at: Date | string;
  finalized_at: Date | string | null;
  consumed_at: Date | string | null;
}

interface WrappedKeyRow {
  paste_id: string;
  device_key_id: string;
  user_entity_ref: string;
  ephemeral_public_key: string;
  wrapped_key: string;
}

/** A paste row joined with the wrapped key of one device. */
interface ReadablePasteRow extends PasteRow {
  ephemeral_public_key: string;
  wrapped_key: string;
}

/**
 * A paste as stored: metadata, counters and the pointer to its ciphertext. Nothing
 * here is readable without a data key, which the backend never sees.
 *
 * @public
 */
export interface PasteRecord {
  id: string;
  createdByEntityRef: string;
  kind: PasteKind;
  metaCiphertext: string;
  chunkCount: number;
  sizeBytes: number;
  storageKey: string;
  expiresAt: string;
  burnAfterRead: boolean;
  maxReads?: number;
  readCount: number;
  linkEnabled: boolean;
  createdAt: string;
  finalizedAt?: string;
  consumedAt?: string;
}

/** @public */
export interface InsertPasteOptions {
  id: string;
  createdByEntityRef: string;
  kind: PasteKind;
  metaCiphertext: string;
  chunkCount: number;
  sizeBytes: number;
  storageKey: string;
  expiresAt: Date;
  burnAfterRead: boolean;
  maxReads?: number;
  linkTokenHash?: string;
  createdAt: Date;
  recipientEntityRefs: string[];
  wrappedKeys: Array<WrappedKey & { userEntityRef: string }>;
}

/** @public */
export interface PurgeablePaste {
  id: string;
  storageKey: string;
}

/**
 * Reads and writes pastes, their recipients, their wrapped keys and their read trail.
 *
 * @public
 */
export class PasteStore {
  readonly #client: Knex;

  static create(client: Knex): PasteStore {
    return new PasteStore(client);
  }

  private constructor(client: Knex) {
    this.#client = client;
  }

  /**
   * Creates a paste with its recipients and wrapped keys in one transaction, so a
   * paste is never visible without the keys that make it readable.
   */
  async insert(options: InsertPasteOptions): Promise<void> {
    await this.#client.transaction(async transaction => {
      await transaction(PASTES).insert({
        id: options.id,
        created_by_entity_ref: options.createdByEntityRef,
        kind: options.kind,
        meta_ciphertext: options.metaCiphertext,
        chunk_count: options.chunkCount,
        size_bytes: options.sizeBytes,
        storage_key: options.storageKey,
        expires_at: options.expiresAt,
        burn_after_read: options.burnAfterRead,
        max_reads: options.maxReads ?? null,
        link_token_hash: options.linkTokenHash ?? null,
        created_at: options.createdAt,
      });

      if (options.recipientEntityRefs.length > 0) {
        await transaction(RECIPIENTS).insert(
          options.recipientEntityRefs.map(recipientEntityRef => ({
            paste_id: options.id,
            recipient_entity_ref: recipientEntityRef,
          })),
        );
      }

      if (options.wrappedKeys.length > 0) {
        await transaction(WRAPPED_KEYS).insert(
          options.wrappedKeys.map(wrappedKey => ({
            paste_id: options.id,
            device_key_id: wrappedKey.deviceKeyId,
            user_entity_ref: wrappedKey.userEntityRef,
            ephemeral_public_key: JSON.stringify(wrappedKey.ephemeralPublicKey),
            wrapped_key: wrappedKey.wrappedKey,
          })),
        );
      }
    });
  }

  async getById(id: string): Promise<PasteRecord | undefined> {
    const row = await this.#client<PasteRow>(PASTES).where({ id }).first();
    return row && toPasteRecord(row);
  }

  async getLinkTokenHash(id: string): Promise<string | undefined> {
    const row = await this.#client<PasteRow>(PASTES).where({ id }).first('link_token_hash');
    return row?.link_token_hash ?? undefined;
  }

  async listRecipientRefs(pasteIds: string[]): Promise<Map<string, string[]>> {
    if (pasteIds.length === 0) {
      return new Map();
    }
    const rows = await this.#client(RECIPIENTS)
      .whereIn('paste_id', pasteIds)
      .select('paste_id', 'recipient_entity_ref');
    const refsByPaste = new Map<string, string[]>();
    for (const row of rows) {
      const refs = refsByPaste.get(row.paste_id) ?? [];
      refs.push(row.recipient_entity_ref);
      refsByPaste.set(row.paste_id, refs);
    }
    return refsByPaste;
  }

  async findWrappedKey(options: { pasteId: string; deviceKeyId: string }): Promise<WrappedKey | undefined> {
    const row = await this.#client<WrappedKeyRow>(WRAPPED_KEYS)
      .where({ paste_id: options.pasteId, device_key_id: options.deviceKeyId })
      .first();
    return row && toWrappedKey(row);
  }

  /**
   * Lists the pastes that one device can decrypt, newest first. A paste without a
   * wrapped key for that device is not returned at all.
   */
  async listReadableByDevice(options: {
    userEntityRef: string;
    deviceKeyId: string;
    limit: number;
    now: Date;
  }): Promise<Array<{ paste: PasteRecord; wrappedKey: WrappedKey }>> {
    const rows: ReadablePasteRow[] = await this.#client(PASTES)
      .join(WRAPPED_KEYS, `${PASTES}.id`, `${WRAPPED_KEYS}.paste_id`)
      .where({
        [`${WRAPPED_KEYS}.user_entity_ref`]: options.userEntityRef,
        [`${WRAPPED_KEYS}.device_key_id`]: options.deviceKeyId,
      })
      .whereNotNull(`${PASTES}.finalized_at`)
      .where(`${PASTES}.expires_at`, '>', options.now)
      .orderBy(`${PASTES}.created_at`, 'desc')
      .limit(options.limit)
      .select(
        `${PASTES}.*`,
        `${WRAPPED_KEYS}.device_key_id`,
        `${WRAPPED_KEYS}.ephemeral_public_key`,
        `${WRAPPED_KEYS}.wrapped_key`,
      );

    return rows.map(row => ({
      paste: toPasteRecord(row),
      wrappedKey: toWrappedKey({
        paste_id: row.id,
        device_key_id: options.deviceKeyId,
        user_entity_ref: options.userEntityRef,
        ephemeral_public_key: row.ephemeral_public_key,
        wrapped_key: row.wrapped_key,
      }),
    }));
  }

  async listCreatedBy(options: { userEntityRef: string; limit: number; now: Date }): Promise<PasteRecord[]> {
    const rows = await this.#client<PasteRow>(PASTES)
      .where({ created_by_entity_ref: options.userEntityRef })
      .where('expires_at', '>', options.now)
      .orderBy('created_at', 'desc')
      .limit(options.limit);
    return rows.map(toPasteRecord);
  }

  async recordChunk(options: { pasteId: string; index: number; sizeBytes: number; at: Date }): Promise<void> {
    await this.#client(CHUNKS)
      .insert({
        paste_id: options.pasteId,
        chunk_index: options.index,
        size_bytes: options.sizeBytes,
        uploaded_at: options.at,
      })
      .onConflict(['paste_id', 'chunk_index'])
      .merge(['size_bytes', 'uploaded_at']);
  }

  async countChunks(pasteId: string): Promise<number> {
    const rows = await this.#client(CHUNKS).where({ paste_id: pasteId }).count({ count: '*' });
    return Number(rows[0].count);
  }

  async sumChunkSizes(pasteId: string): Promise<number> {
    const rows = await this.#client(CHUNKS).where({ paste_id: pasteId }).sum({ total: 'size_bytes' });
    return Number(rows[0].total ?? 0);
  }

  async markFinalized(options: { id: string; at: Date }): Promise<void> {
    await this.#client(PASTES).where({ id: options.id }).update({ finalized_at: options.at });
  }

  async markConsumed(options: { id: string; at: Date }): Promise<void> {
    await this.#client(PASTES).where({ id: options.id }).whereNull('consumed_at').update({ consumed_at: options.at });
  }

  async incrementReadCount(id: string): Promise<void> {
    await this.#client(PASTES).where({ id }).increment('read_count', 1);
  }

  async recordRead(options: {
    pasteId: string;
    readerEntityRef?: string;
    deviceKeyId?: string;
    via: PasteReadEntry['via'];
    at: Date;
  }): Promise<void> {
    await this.#client(READS).insert({
      paste_id: options.pasteId,
      reader_entity_ref: options.readerEntityRef ?? null,
      device_key_id: options.deviceKeyId ?? null,
      via: options.via,
      read_at: options.at,
    });
  }

  async listReads(pasteId: string): Promise<PasteReadEntry[]> {
    const rows = await this.#client(READS).where({ paste_id: pasteId }).orderBy('read_at', 'desc');
    return rows.map(row => ({
      readerEntityRef: row.reader_entity_ref ?? undefined,
      via: row.via,
      readAt: toIsoString(row.read_at),
    }));
  }

  /**
   * Lists pastes that must disappear: expired, fully read, or burned and past their
   * retry grace period.
   */
  async listPurgeable(options: { now: Date; burnGraceBefore: Date; limit: number }): Promise<PurgeablePaste[]> {
    const rows = await this.#client<PasteRow>(PASTES)
      .where(builder =>
        builder
          .where('expires_at', '<=', options.now)
          .orWhere(burned =>
            burned
              .where({ burn_after_read: true })
              .whereNotNull('consumed_at')
              .where('consumed_at', '<=', options.burnGraceBefore),
          )
          .orWhere(exhausted => exhausted.whereNotNull('max_reads').whereRaw('read_count >= max_reads')),
      )
      .limit(options.limit)
      .select('id', 'storage_key');

    return rows.map(row => ({ id: row.id, storageKey: row.storage_key }));
  }

  /**
   * Deletes a paste and everything that hangs off it apart from its read trail, which
   * is kept for auditing. Children are removed explicitly because SQLite does not
   * enforce foreign keys by default.
   */
  async delete(id: string): Promise<void> {
    await this.#client.transaction(async transaction => {
      await transaction(CHUNKS).where({ paste_id: id }).delete();
      await transaction(WRAPPED_KEYS).where({ paste_id: id }).delete();
      await transaction(RECIPIENTS).where({ paste_id: id }).delete();
      await transaction(PASTES).where({ id }).delete();
    });
  }
}

function toPasteRecord(row: PasteRow): PasteRecord {
  return {
    id: row.id,
    createdByEntityRef: row.created_by_entity_ref,
    // Only ever written from a validated PasteKind.
    kind: row.kind as PasteKind,
    metaCiphertext: row.meta_ciphertext,
    chunkCount: Number(row.chunk_count),
    sizeBytes: Number(row.size_bytes),
    storageKey: row.storage_key,
    expiresAt: toIsoString(row.expires_at),
    burnAfterRead: Boolean(row.burn_after_read),
    maxReads: row.max_reads ?? undefined,
    readCount: Number(row.read_count),
    linkEnabled: Boolean(row.link_token_hash),
    createdAt: toIsoString(row.created_at),
    finalizedAt: row.finalized_at ? toIsoString(row.finalized_at) : undefined,
    consumedAt: row.consumed_at ? toIsoString(row.consumed_at) : undefined,
  };
}

function toWrappedKey(row: WrappedKeyRow): WrappedKey {
  return {
    deviceKeyId: row.device_key_id,
    // Written by this plugin only, after the JWK passed request validation.
    ephemeralPublicKey: JSON.parse(row.ephemeral_public_key) as EcdhPublicKeyJwk,
    wrappedKey: row.wrapped_key,
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
