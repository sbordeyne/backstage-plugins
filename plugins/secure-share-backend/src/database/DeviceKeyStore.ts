import { DeviceKey, EcdhPublicKeyJwk } from '@sbordeyne/secure-share-common';
import { Knex } from 'knex';

const TABLE = 'secure_share_device_keys';

interface DeviceKeyRow {
  id: string;
  user_entity_ref: string;
  public_key: string;
  fingerprint: string;
  label: string;
  created_at: Date | string;
  last_used_at: Date | string | null;
  revoked_at: Date | string | null;
}

/**
 * A device key together with the user it belongs to.
 *
 * @public
 */
export interface StoredDeviceKey extends DeviceKey {
  userEntityRef: string;
}

/** @public */
export interface InsertDeviceKeyOptions {
  id: string;
  userEntityRef: string;
  publicKey: EcdhPublicKeyJwk;
  fingerprint: string;
  label: string;
  createdAt: Date;
}

/**
 * Reads and writes the enrolled device public keys.
 *
 * Revoked keys are kept so that already wrapped keys can still be traced in the
 * audit trail, but they are never returned to a sender.
 *
 * @public
 */
export class DeviceKeyStore {
  readonly #client: Knex;

  static create(client: Knex): DeviceKeyStore {
    return new DeviceKeyStore(client);
  }

  private constructor(client: Knex) {
    this.#client = client;
  }

  async insert(options: InsertDeviceKeyOptions): Promise<void> {
    await this.#client(TABLE).insert({
      id: options.id,
      user_entity_ref: options.userEntityRef,
      public_key: JSON.stringify(options.publicKey),
      fingerprint: options.fingerprint,
      label: options.label,
      created_at: options.createdAt,
    });
  }

  async listActiveByUser(userEntityRef: string): Promise<StoredDeviceKey[]> {
    const rows = await this.#activeKeys().where({ user_entity_ref: userEntityRef }).orderBy('created_at', 'asc');
    return rows.map(toStoredDeviceKey);
  }

  async listActiveByUsers(userEntityRefs: string[]): Promise<StoredDeviceKey[]> {
    if (userEntityRefs.length === 0) {
      return [];
    }
    const rows = await this.#activeKeys().whereIn('user_entity_ref', userEntityRefs);
    return rows.map(toStoredDeviceKey);
  }

  async findActiveById(id: string): Promise<StoredDeviceKey | undefined> {
    const row = await this.#activeKeys().where({ id }).first();
    return row && toStoredDeviceKey(row);
  }

  async findActiveByFingerprint(options: {
    userEntityRef: string;
    fingerprint: string;
  }): Promise<StoredDeviceKey | undefined> {
    const row = await this.#activeKeys()
      .where({ user_entity_ref: options.userEntityRef, fingerprint: options.fingerprint })
      .first();
    return row && toStoredDeviceKey(row);
  }

  async countActiveByUser(userEntityRef: string): Promise<number> {
    const rows = await this.#client(TABLE)
      .whereNull('revoked_at')
      .where({ user_entity_ref: userEntityRef })
      .count({ count: '*' });
    return Number(rows[0].count);
  }

  async revoke(options: { id: string; userEntityRef: string; revokedAt: Date }): Promise<boolean> {
    const updated = await this.#activeKeys()
      .where({ id: options.id, user_entity_ref: options.userEntityRef })
      .update({ revoked_at: options.revokedAt });
    return updated > 0;
  }

  async markUsed(options: { id: string; at: Date }): Promise<void> {
    await this.#client(TABLE).where({ id: options.id }).update({ last_used_at: options.at });
  }

  #activeKeys(): Knex.QueryBuilder<DeviceKeyRow, DeviceKeyRow[]> {
    return this.#client<DeviceKeyRow>(TABLE).whereNull('revoked_at');
  }
}

function toStoredDeviceKey(row: DeviceKeyRow): StoredDeviceKey {
  return {
    id: row.id,
    userEntityRef: row.user_entity_ref,
    // Written by this plugin only, after the JWK passed request validation.
    publicKey: JSON.parse(row.public_key) as EcdhPublicKeyJwk,
    fingerprint: row.fingerprint,
    label: row.label,
    createdAt: toIsoString(row.created_at),
    lastUsedAt: row.last_used_at ? toIsoString(row.last_used_at) : undefined,
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
