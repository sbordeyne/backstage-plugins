import { mockCredentials, mockServices, TestDatabases } from '@backstage/backend-test-utils';
import { ConflictError, InputError, NotFoundError } from '@backstage/errors';
import { EcdhPublicKeyJwk } from '@sbordeyne/secure-share-common';
import path from 'path';
import { DeviceKeyStore } from '../database/DeviceKeyStore';
import { computeKeyFingerprint } from '../fingerprints';
import { DeviceKeyService } from './DeviceKeyService';
import { RecipientResolver, ResolvedRecipientUsers } from './RecipientResolver';

const MIGRATIONS_DIRECTORY = path.resolve(__dirname, '../../migrations');

const aliceCredentials = mockCredentials.user('user:default/alice');
const bobCredentials = mockCredentials.user('user:default/bob');

function publicKeyOf(seed: string): EcdhPublicKeyJwk {
  return {
    kty: 'EC',
    crv: 'P-256',
    x: seed.padEnd(43, 'x').slice(0, 43),
    y: seed.padEnd(43, 'y').slice(0, 43),
  };
}

describe('DeviceKeyService', () => {
  const databases = TestDatabases.create({ ids: ['SQLITE_3'] });

  async function createService(
    options: { maxDeviceKeysPerUser?: number; maxRecipientKeys?: number; resolved?: ResolvedRecipientUsers } = {},
  ): Promise<{ service: DeviceKeyService; store: DeviceKeyStore }> {
    const client = await databases.init('SQLITE_3');
    await client.migrate.latest({ directory: MIGRATIONS_DIRECTORY });
    const store = DeviceKeyStore.create(client);
    const recipientResolver = {
      resolve: jest.fn(async () => options.resolved ?? { users: [], unresolvedEntityRefs: [] }),
      // Catalog expansion is covered by RecipientResolver's own tests.
    } as unknown as RecipientResolver;

    return {
      store,
      service: DeviceKeyService.create({
        store,
        recipientResolver,
        logger: mockServices.logger.mock(),
        maxDeviceKeysPerUser: options.maxDeviceKeysPerUser ?? 10,
        maxRecipientKeys: options.maxRecipientKeys ?? 500,
      }),
    };
  }

  describe('enroll', () => {
    it('computes the fingerprint from the key itself', async () => {
      const { service } = await createService();
      const publicKey = publicKeyOf('alice-laptop');

      const enrolled = await service.enroll({ publicKey, label: 'Chrome on macOS' }, { credentials: aliceCredentials });

      expect(enrolled).toEqual({
        id: expect.any(String),
        fingerprint: computeKeyFingerprint(publicKey),
        label: 'Chrome on macOS',
        createdAt: expect.any(String),
        lastUsedAt: undefined,
      });
    });

    it('never returns key material to the client', async () => {
      const { service } = await createService();

      const enrolled = await service.enroll(
        { publicKey: publicKeyOf('alice-laptop'), label: 'Chrome' },
        { credentials: aliceCredentials },
      );

      expect(enrolled).not.toHaveProperty('publicKey');
    });

    it('is idempotent when the same browser enrolls twice', async () => {
      const { service } = await createService();
      const publicKey = publicKeyOf('alice-laptop');

      const first = await service.enroll({ publicKey, label: 'Chrome' }, { credentials: aliceCredentials });
      const second = await service.enroll({ publicKey, label: 'Chrome again' }, { credentials: aliceCredentials });

      expect(second.id).toBe(first.id);
      expect(second.label).toBe('Chrome');
    });

    it('lets two users enroll the same key independently', async () => {
      const { service } = await createService();
      const publicKey = publicKeyOf('shared');

      const alice = await service.enroll({ publicKey, label: 'Chrome' }, { credentials: aliceCredentials });
      const bob = await service.enroll({ publicKey, label: 'Chrome' }, { credentials: bobCredentials });

      expect(bob.id).not.toBe(alice.id);
    });

    it('refuses to enroll more keys than the configured maximum', async () => {
      const { service } = await createService({ maxDeviceKeysPerUser: 1 });
      await service.enroll({ publicKey: publicKeyOf('first'), label: 'Chrome' }, { credentials: aliceCredentials });

      await expect(
        service.enroll({ publicKey: publicKeyOf('second'), label: 'Firefox' }, { credentials: aliceCredentials }),
      ).rejects.toThrow(ConflictError);
    });

    it('frees a slot when a key is revoked', async () => {
      const { service } = await createService({ maxDeviceKeysPerUser: 1 });
      const first = await service.enroll(
        { publicKey: publicKeyOf('first'), label: 'Chrome' },
        { credentials: aliceCredentials },
      );

      await service.revoke({ id: first.id }, { credentials: aliceCredentials });

      await expect(
        service.enroll({ publicKey: publicKeyOf('second'), label: 'Firefox' }, { credentials: aliceCredentials }),
      ).resolves.toBeDefined();
    });
  });

  describe('listOwn', () => {
    it('returns only the caller keys', async () => {
      const { service } = await createService();
      await service.enroll({ publicKey: publicKeyOf('alice'), label: 'Chrome' }, { credentials: aliceCredentials });
      await service.enroll({ publicKey: publicKeyOf('bob'), label: 'Safari' }, { credentials: bobCredentials });

      const keys = await service.listOwn({ credentials: aliceCredentials });

      expect(keys.map(key => key.label)).toEqual(['Chrome']);
    });
  });

  describe('revoke', () => {
    it('refuses to revoke a key owned by somebody else', async () => {
      const { service } = await createService();
      const alice = await service.enroll(
        { publicKey: publicKeyOf('alice'), label: 'Chrome' },
        { credentials: aliceCredentials },
      );

      await expect(service.revoke({ id: alice.id }, { credentials: bobCredentials })).rejects.toThrow(NotFoundError);
      expect(await service.listOwn({ credentials: aliceCredentials })).toHaveLength(1);
    });

    it('rejects an unknown key', async () => {
      const { service } = await createService();

      await expect(
        service.revoke({ id: '00000000-0000-4000-8000-000000000000' }, { credentials: aliceCredentials }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('resolveRecipients', () => {
    const resolved: ResolvedRecipientUsers = {
      users: [
        { entityRef: 'user:default/alice', displayName: 'Alice', viaEntityRefs: ['group:default/platform'] },
        { entityRef: 'user:default/bob', viaEntityRefs: ['group:default/platform'] },
      ],
      unresolvedEntityRefs: ['group:default/ghost'],
    };

    it('returns the device keys each recipient must be wrapped for', async () => {
      const { service } = await createService({ resolved });
      await service.enroll({ publicKey: publicKeyOf('alice-1'), label: 'Chrome' }, { credentials: aliceCredentials });
      await service.enroll({ publicKey: publicKeyOf('alice-2'), label: 'Firefox' }, { credentials: aliceCredentials });

      const response = await service.resolveRecipients(
        { entityRefs: ['group:default/platform'] },
        { credentials: aliceCredentials },
      );

      expect(response.recipients).toEqual([
        {
          userEntityRef: 'user:default/alice',
          displayName: 'Alice',
          viaEntityRefs: ['group:default/platform'],
          keys: [
            expect.objectContaining({ label: 'Chrome', publicKey: publicKeyOf('alice-1') }),
            expect.objectContaining({ label: 'Firefox' }),
          ],
        },
      ]);
      expect(response.totalKeyCount).toBe(2);
    });

    it('names the users that cannot be given access because they never enrolled', async () => {
      const { service } = await createService({ resolved });
      await service.enroll({ publicKey: publicKeyOf('alice-1'), label: 'Chrome' }, { credentials: aliceCredentials });

      const response = await service.resolveRecipients(
        { entityRefs: ['group:default/platform'] },
        { credentials: aliceCredentials },
      );

      expect(response.userEntityRefsWithoutKeys).toEqual(['user:default/bob']);
      expect(response.unresolvedEntityRefs).toEqual(['group:default/ghost']);
    });

    it('refuses an audience larger than the recipient key cap', async () => {
      const { service } = await createService({ resolved, maxRecipientKeys: 1 });
      await service.enroll({ publicKey: publicKeyOf('alice-1'), label: 'Chrome' }, { credentials: aliceCredentials });
      await service.enroll({ publicKey: publicKeyOf('alice-2'), label: 'Firefox' }, { credentials: aliceCredentials });

      await expect(
        service.resolveRecipients({ entityRefs: ['group:default/platform'] }, { credentials: aliceCredentials }),
      ).rejects.toThrow(InputError);
    });

    it('does not return revoked keys to a sender', async () => {
      const { service } = await createService({ resolved });
      const key = await service.enroll(
        { publicKey: publicKeyOf('alice-1'), label: 'Chrome' },
        { credentials: aliceCredentials },
      );
      await service.revoke({ id: key.id }, { credentials: aliceCredentials });

      const response = await service.resolveRecipients(
        { entityRefs: ['group:default/platform'] },
        { credentials: aliceCredentials },
      );

      expect(response.recipients).toEqual([]);
      expect(response.userEntityRefsWithoutKeys).toEqual(['user:default/alice', 'user:default/bob']);
    });
  });
});
