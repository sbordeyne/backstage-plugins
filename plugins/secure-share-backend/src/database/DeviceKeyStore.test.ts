import { TestDatabaseId, TestDatabases } from '@backstage/backend-test-utils';
import { EcdhPublicKeyJwk } from '@sbordeyne/secure-share-common';
import { randomUUID } from 'crypto';
import path from 'path';
import { DeviceKeyStore } from './DeviceKeyStore';

const MIGRATIONS_DIRECTORY = path.resolve(__dirname, '../../migrations');

const publicKey: EcdhPublicKeyJwk = {
  kty: 'EC',
  crv: 'P-256',
  x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU',
  y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0',
};

describe('DeviceKeyStore', () => {
  // SQLite matches local development and Postgres matches production. Postgres needs a
  // container, which the CI runners do not provide, so it is opt-in through
  // BACKSTAGE_TEST_ENABLE_DOCKER=1.
  const databases = TestDatabases.create({
    ids: ['SQLITE_3', 'POSTGRES_17'],
    disableDocker: !process.env.BACKSTAGE_TEST_ENABLE_DOCKER,
  });

  async function createStore(databaseId: TestDatabaseId): Promise<DeviceKeyStore> {
    const client = await databases.init(databaseId);
    await client.migrate.latest({ directory: MIGRATIONS_DIRECTORY });
    return DeviceKeyStore.create(client);
  }

  async function insertKey(
    store: DeviceKeyStore,
    overrides: Partial<{ id: string; userEntityRef: string; fingerprint: string; label: string }> = {},
  ): Promise<string> {
    const id = overrides.id ?? randomUUID();
    await store.insert({
      id,
      userEntityRef: overrides.userEntityRef ?? 'user:default/alice',
      publicKey,
      fingerprint: overrides.fingerprint ?? 'fingerprint-1',
      label: overrides.label ?? 'Chrome on macOS',
      createdAt: new Date(),
    });
    return id;
  }

  describe.each(databases.eachSupportedId())('%p', databaseId => {
    it('stores and returns a device key with its parsed public key', async () => {
      const store = await createStore(databaseId);
      const id = await insertKey(store);

      const keys = await store.listActiveByUser('user:default/alice');

      expect(keys).toEqual([
        {
          id,
          userEntityRef: 'user:default/alice',
          publicKey,
          fingerprint: 'fingerprint-1',
          label: 'Chrome on macOS',
          createdAt: expect.any(String),
          lastUsedAt: undefined,
        },
      ]);
    });

    it('scopes keys to their owner', async () => {
      const store = await createStore(databaseId);
      await insertKey(store, { userEntityRef: 'user:default/alice' });
      await insertKey(store, { userEntityRef: 'user:default/bob' });

      expect(await store.listActiveByUser('user:default/bob')).toHaveLength(1);
      expect(await store.listActiveByUsers(['user:default/alice', 'user:default/bob'])).toHaveLength(2);
      expect(await store.listActiveByUsers([])).toEqual([]);
    });

    it('finds a key by fingerprint so that re-enrolling the same browser is idempotent', async () => {
      const store = await createStore(databaseId);
      await insertKey(store, { fingerprint: 'known' });

      const found = await store.findActiveByFingerprint({
        userEntityRef: 'user:default/alice',
        fingerprint: 'known',
      });

      expect(found?.fingerprint).toBe('known');
      await expect(
        store.findActiveByFingerprint({ userEntityRef: 'user:default/bob', fingerprint: 'known' }),
      ).resolves.toBeUndefined();
    });

    it('counts only active keys', async () => {
      const store = await createStore(databaseId);
      const revokedId = await insertKey(store, { fingerprint: 'first' });
      await insertKey(store, { fingerprint: 'second' });

      await store.revoke({ id: revokedId, userEntityRef: 'user:default/alice', revokedAt: new Date() });

      expect(await store.countActiveByUser('user:default/alice')).toBe(1);
      expect(await store.findActiveById(revokedId)).toBeUndefined();
    });

    it('refuses to revoke a key that belongs to somebody else', async () => {
      const store = await createStore(databaseId);
      const id = await insertKey(store, { userEntityRef: 'user:default/alice' });

      const revoked = await store.revoke({ id, userEntityRef: 'user:default/bob', revokedAt: new Date() });

      expect(revoked).toBe(false);
      expect(await store.findActiveById(id)).toBeDefined();
    });

    it('records when a key was last used', async () => {
      const store = await createStore(databaseId);
      const id = await insertKey(store);

      await store.markUsed({ id, at: new Date() });

      const [key] = await store.listActiveByUser('user:default/alice');
      expect(key.lastUsedAt).toEqual(expect.any(String));
    });

    it('keeps a single active key per user and fingerprint', async () => {
      const store = await createStore(databaseId);
      await insertKey(store, { fingerprint: 'duplicate' });

      // The invariant is what matters, not which layer refuses: the unique index makes the
      // second insert fail, and re-enrolling the same browser must not add a second row.
      await insertKey(store, { fingerprint: 'duplicate' }).catch(() => undefined);

      expect(await store.listActiveByUser('user:default/alice')).toHaveLength(1);
    });
  });
});
