import { EcdhPublicKeyJwk } from '@sbordeyne/secure-share-common';

const DATABASE_NAME = 'secure-share';
const DATABASE_VERSION = 1;
const STORE_NAME = 'device-key';
const RECORD_ID = 'current';

/**
 * This browser's device key, as held in IndexedDB.
 *
 * `privateKey` is stored as a non-extractable `CryptoKey`: IndexedDB keeps the key object
 * itself, so the key bytes are never exposed to JavaScript, not even while being saved.
 *
 * @public
 */
export interface StoredDeviceKey {
  publicKey: EcdhPublicKeyJwk;
  privateKey: CryptoKey;
  fingerprint: string;
  /** Assigned by the backend once the public key has been enrolled. */
  deviceKeyId?: string;
}

/**
 * Custody of the device key, scoped to one browser profile.
 *
 * Clearing site data destroys the key, and with it the ability to read pastes that were
 * wrapped for it. That is the accepted cost of keeping no copy anywhere else.
 *
 * @public
 */
export class DeviceKeyStorage {
  static create(): DeviceKeyStorage {
    return new DeviceKeyStorage();
  }

  async load(): Promise<StoredDeviceKey | undefined> {
    const database = await this.#open();
    try {
      return await request<StoredDeviceKey | undefined>(
        database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(RECORD_ID),
      );
    } finally {
      database.close();
    }
  }

  async save(deviceKey: StoredDeviceKey): Promise<void> {
    const database = await this.#open();
    try {
      await request(database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(deviceKey, RECORD_ID));
    } finally {
      database.close();
    }
  }

  async clear(): Promise<void> {
    const database = await this.#open();
    try {
      await request(database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(RECORD_ID));
    } finally {
      database.close();
    }
  }

  async #open(): Promise<IDBDatabase> {
    const openRequest = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    openRequest.onupgradeneeded = () => {
      if (!openRequest.result.objectStoreNames.contains(STORE_NAME)) {
        openRequest.result.createObjectStore(STORE_NAME);
      }
    };
    return await request<IDBDatabase>(openRequest);
  }
}

function request<T>(idbRequest: IDBRequest): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    idbRequest.onsuccess = () => resolve(idbRequest.result as T);
    idbRequest.onerror = () => reject(idbRequest.error ?? new Error('IndexedDB request failed'));
  });
}
