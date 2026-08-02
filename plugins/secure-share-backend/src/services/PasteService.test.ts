import { createMockDirectory, mockCredentials, mockServices, TestDatabases } from '@backstage/backend-test-utils';
import { InputError, NotFoundError } from '@backstage/errors';
import {
  CreatePasteRequest,
  EcdhPublicKeyJwk,
  SecureShareSharedConfig,
  WrappedKey,
} from '@sbordeyne/secure-share-common';
import { randomUUID } from 'crypto';
import path from 'path';
import { DeviceKeyStore } from '../database/DeviceKeyStore';
import { PasteStore } from '../database/PasteStore';
import { LocalBlobStore } from '../storage';
import { PasteService } from './PasteService';

const MIGRATIONS_DIRECTORY = path.resolve(__dirname, '../../migrations');
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const alice = mockCredentials.user('user:default/alice');
const bob = mockCredentials.user('user:default/bob');

const publicKey: EcdhPublicKeyJwk = {
  kty: 'EC',
  crv: 'P-256',
  x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU',
  y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0',
};

const config: SecureShareSharedConfig = {
  card: { limit: 5 },
  expiration: { defaultMs: DAY_MS, maxMs: 7 * DAY_MS, optionsMs: [DAY_MS] },
  limits: {
    maxFileSizeBytes: 64 * 1024,
    maxTextSizeBytes: 4096,
    chunkSizeBytes: 1024,
    maxRecipientKeys: 10,
  },
};

describe('PasteService', () => {
  const databases = TestDatabases.create({ ids: ['SQLITE_3'] });
  const mockDir = createMockDirectory();

  interface Harness {
    service: PasteService;
    pasteStore: PasteStore;
    deviceKeyStore: DeviceKeyStore;
    blobStore: LocalBlobStore;
    enrollDevice: (userEntityRef: string) => Promise<string>;
    /** Moves a paste's expiry into the past, which no route is allowed to do. */
    expirePaste: (pasteId: string) => Promise<void>;
  }

  async function createHarness(options: { burnGracePeriodMs?: number } = {}): Promise<Harness> {
    const client = await databases.init('SQLITE_3');
    await client.migrate.latest({ directory: MIGRATIONS_DIRECTORY });
    const pasteStore = PasteStore.create(client);
    const deviceKeyStore = DeviceKeyStore.create(client);
    const blobStore = LocalBlobStore.create({ rootPath: path.join(mockDir.path, randomUUID()) });

    const enrollDevice = async (userEntityRef: string): Promise<string> => {
      const id = randomUUID();
      await deviceKeyStore.insert({
        id,
        userEntityRef,
        publicKey,
        fingerprint: id,
        label: 'Chrome',
        createdAt: new Date(),
      });
      return id;
    };

    const expirePaste = async (pasteId: string): Promise<void> => {
      await client('secure_share_pastes')
        .where({ id: pasteId })
        .update({ expires_at: new Date(Date.now() - MINUTE_MS) });
    };

    return {
      pasteStore,
      deviceKeyStore,
      blobStore,
      enrollDevice,
      expirePaste,
      service: PasteService.create({
        pastes: pasteStore,
        deviceKeys: deviceKeyStore,
        blobStore,
        config,
        burnGracePeriodMs: options.burnGracePeriodMs ?? 5 * MINUTE_MS,
        logger: mockServices.logger.mock(),
      }),
    };
  }

  function createRequest(overrides: Partial<CreatePasteRequest> = {}): CreatePasteRequest {
    return {
      kind: 'text',
      metaCiphertext: 'sealed-metadata',
      chunkCount: 1,
      sizeBytes: 10,
      expiresAt: new Date(Date.now() + HOUR_MS).toISOString(),
      burnAfterRead: false,
      linkEnabled: false,
      recipientEntityRefs: ['user:default/bob'],
      wrappedKeys: [],
      ...overrides,
    };
  }

  function wrappedFor(deviceKeyId: string): WrappedKey {
    return { deviceKeyId, ephemeralPublicKey: publicKey, wrappedKey: 'wrapped-data-key' };
  }

  /** Creates, uploads and finalizes a one chunk paste readable by `deviceKeyId`. */
  async function publishPaste(
    harness: Harness,
    options: { deviceKeyId?: string; chunk?: Buffer; overrides?: Partial<CreatePasteRequest> } = {},
  ): Promise<string> {
    const chunk = options.chunk ?? Buffer.from('ciphertext');
    const { id } = await harness.service.create(
      createRequest({
        sizeBytes: chunk.length,
        wrappedKeys: options.deviceKeyId ? [wrappedFor(options.deviceKeyId)] : [],
        ...options.overrides,
      }),
      { credentials: alice },
    );
    await harness.service.uploadChunk({ pasteId: id, index: 0, data: chunk }, { credentials: alice });
    await harness.service.finalize({ pasteId: id }, { credentials: alice });
    return id;
  }

  async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  describe('create', () => {
    it('stores a paste that is not yet readable', async () => {
      const harness = await createHarness();
      const deviceKeyId = await harness.enrollDevice('user:default/bob');

      const { id, linkToken } = await harness.service.create(
        createRequest({ wrappedKeys: [wrappedFor(deviceKeyId)] }),
        { credentials: alice },
      );

      expect(id).toHaveLength(22);
      expect(linkToken).toBeUndefined();
      const stored = await harness.pasteStore.getById(id);
      expect(stored).toMatchObject({ createdByEntityRef: 'user:default/alice', finalizedAt: undefined });
    });

    it('mints a link token that is only stored as a digest', async () => {
      const harness = await createHarness();

      const { id, linkToken } = await harness.service.create(createRequest({ linkEnabled: true }), {
        credentials: alice,
      });

      expect(linkToken).toEqual(expect.any(String));
      const storedHash = await harness.pasteStore.getLinkTokenHash(id);
      expect(storedHash).toBeDefined();
      expect(storedHash).not.toBe(linkToken);
    });

    it('rejects a wrapped key for a device that does not exist', async () => {
      const harness = await createHarness();

      await expect(
        harness.service.create(createRequest({ wrappedKeys: [wrappedFor(randomUUID())] }), { credentials: alice }),
      ).rejects.toThrow(InputError);
    });

    it('rejects a wrapped key for a revoked device', async () => {
      const harness = await createHarness();
      const deviceKeyId = await harness.enrollDevice('user:default/bob');
      await harness.deviceKeyStore.revoke({
        id: deviceKeyId,
        userEntityRef: 'user:default/bob',
        revokedAt: new Date(),
      });

      await expect(
        harness.service.create(createRequest({ wrappedKeys: [wrappedFor(deviceKeyId)] }), { credentials: alice }),
      ).rejects.toThrow(/does not exist or has been revoked/);
    });

    it('refuses a paste that nobody could read', async () => {
      const harness = await createHarness();

      await expect(
        harness.service.create(createRequest({ wrappedKeys: [], linkEnabled: false }), { credentials: alice }),
      ).rejects.toThrow(/at least one recipient device or a secret link/);
    });

    it('refuses an expiry beyond the configured maximum', async () => {
      const harness = await createHarness();

      await expect(
        harness.service.create(
          createRequest({ linkEnabled: true, expiresAt: new Date(Date.now() + 30 * DAY_MS).toISOString() }),
          { credentials: alice },
        ),
      ).rejects.toThrow(/longer than secureShare.expiration.max/);
    });

    it('refuses a text paste larger than the text limit', async () => {
      const harness = await createHarness();

      await expect(
        harness.service.create(createRequest({ linkEnabled: true, sizeBytes: 5000, chunkCount: 5 }), {
          credentials: alice,
        }),
      ).rejects.toThrow(/ciphertext bytes/);
    });

    it('refuses two wrapped keys for the same device', async () => {
      const harness = await createHarness();
      const deviceKeyId = await harness.enrollDevice('user:default/bob');

      await expect(
        harness.service.create(createRequest({ wrappedKeys: [wrappedFor(deviceKeyId), wrappedFor(deviceKeyId)] }), {
          credentials: alice,
        }),
      ).rejects.toThrow(/two wrapped keys for the same device/);
    });

    it('refuses a recipient that is not a user or a group', async () => {
      const harness = await createHarness();

      await expect(
        harness.service.create(createRequest({ linkEnabled: true, recipientEntityRefs: ['component:default/svc'] }), {
          credentials: alice,
        }),
      ).rejects.toThrow(/must be a user: or group: ref/);
    });
  });

  describe('uploadChunk and finalize', () => {
    it('refuses uploads from anybody but the sender', async () => {
      const harness = await createHarness();
      const { id } = await harness.service.create(createRequest({ linkEnabled: true }), { credentials: alice });

      await expect(
        harness.service.uploadChunk({ pasteId: id, index: 0, data: Buffer.from('x') }, { credentials: bob }),
      ).rejects.toThrow(NotFoundError);
    });

    it('refuses a chunk index outside the declared count', async () => {
      const harness = await createHarness();
      const { id } = await harness.service.create(createRequest({ linkEnabled: true }), { credentials: alice });

      await expect(
        harness.service.uploadChunk({ pasteId: id, index: 1, data: Buffer.from('x') }, { credentials: alice }),
      ).rejects.toThrow(/outside the declared 1 chunks/);
    });

    it('refuses a chunk larger than the configured chunk size', async () => {
      const harness = await createHarness();
      const { id } = await harness.service.create(createRequest({ linkEnabled: true }), { credentials: alice });

      await expect(
        harness.service.uploadChunk(
          { pasteId: id, index: 0, data: Buffer.alloc(config.limits.chunkSizeBytes + 29) },
          { credentials: alice },
        ),
      ).rejects.toThrow(/A chunk must be between/);
    });

    it('refuses to finalize a paste whose chunks are missing', async () => {
      const harness = await createHarness();
      const { id } = await harness.service.create(createRequest({ linkEnabled: true, chunkCount: 2, sizeBytes: 20 }), {
        credentials: alice,
      });
      await harness.service.uploadChunk({ pasteId: id, index: 0, data: Buffer.alloc(10) }, { credentials: alice });

      await expect(harness.service.finalize({ pasteId: id }, { credentials: alice })).rejects.toThrow(
        /Expected 2 chunks before finalizing, found 1/,
      );
    });

    it('refuses to finalize when the uploaded size does not match what was declared', async () => {
      const harness = await createHarness();
      const { id } = await harness.service.create(createRequest({ linkEnabled: true, sizeBytes: 10 }), {
        credentials: alice,
      });
      await harness.service.uploadChunk({ pasteId: id, index: 0, data: Buffer.alloc(11) }, { credentials: alice });

      await expect(harness.service.finalize({ pasteId: id }, { credentials: alice })).rejects.toThrow(
        /Declared 10 ciphertext bytes but uploaded 11/,
      );
    });

    it('refuses to change a paste once it is sealed', async () => {
      const harness = await createHarness();
      const id = await publishPaste(harness, { overrides: { linkEnabled: true } });

      await expect(
        harness.service.uploadChunk({ pasteId: id, index: 0, data: Buffer.from('ciphertext') }, { credentials: alice }),
      ).rejects.toThrow(/already been finalized/);
    });

    it('is idempotent when finalizing twice', async () => {
      const harness = await createHarness();
      const id = await publishPaste(harness, { overrides: { linkEnabled: true } });

      await expect(harness.service.finalize({ pasteId: id }, { credentials: alice })).resolves.toBeUndefined();
    });
  });

  describe('read', () => {
    it('gives a recipient the wrapped key their device needs', async () => {
      const harness = await createHarness();
      const deviceKeyId = await harness.enrollDevice('user:default/bob');
      const id = await publishPaste(harness, { deviceKeyId });

      const response = await harness.service.read({
        pasteId: id,
        access: { via: 'recipient', userEntityRef: 'user:default/bob', deviceKeyId },
      });

      expect(response.wrappedKey).toEqual(wrappedFor(deviceKeyId));
      expect(response.paste).toMatchObject({
        metaCiphertext: 'sealed-metadata',
        recipientEntityRefs: ['user:default/bob'],
      });
    });

    it('hides a paste from a device it was not wrapped for', async () => {
      const harness = await createHarness();
      const bobDevice = await harness.enrollDevice('user:default/bob');
      const otherDevice = await harness.enrollDevice('user:default/bob');
      const id = await publishPaste(harness, { deviceKeyId: bobDevice });

      await expect(
        harness.service.read({
          pasteId: id,
          access: { via: 'recipient', userEntityRef: 'user:default/bob', deviceKeyId: otherDevice },
        }),
      ).rejects.toThrow(/no longer available/);
    });

    it('refuses a device key that belongs to another user', async () => {
      const harness = await createHarness();
      const bobDevice = await harness.enrollDevice('user:default/bob');
      const id = await publishPaste(harness, { deviceKeyId: bobDevice });

      await expect(
        harness.service.read({
          pasteId: id,
          access: { via: 'recipient', userEntityRef: 'user:default/eve', deviceKeyId: bobDevice },
        }),
      ).rejects.toThrow(/No active device key/);
    });

    it('hides a paste that has not been finalized', async () => {
      const harness = await createHarness();
      const deviceKeyId = await harness.enrollDevice('user:default/bob');
      const { id } = await harness.service.create(createRequest({ wrappedKeys: [wrappedFor(deviceKeyId)] }), {
        credentials: alice,
      });

      await expect(
        harness.service.read({
          pasteId: id,
          access: { via: 'recipient', userEntityRef: 'user:default/bob', deviceKeyId },
        }),
      ).rejects.toThrow(/no longer available/);
    });

    it('hides an expired paste', async () => {
      const harness = await createHarness();
      const deviceKeyId = await harness.enrollDevice('user:default/bob');
      const id = await publishPaste(harness, { deviceKeyId });
      await harness.expirePaste(id);

      await expect(
        harness.service.read({
          pasteId: id,
          access: { via: 'recipient', userEntityRef: 'user:default/bob', deviceKeyId },
        }),
      ).rejects.toThrow(/no longer available/);
    });

    it('gives a link reader no wrapped key, because their key is in the fragment', async () => {
      const harness = await createHarness();
      const { id, linkToken } = await harness.service.create(createRequest({ linkEnabled: true, sizeBytes: 10 }), {
        credentials: alice,
      });
      await harness.service.uploadChunk({ pasteId: id, index: 0, data: Buffer.alloc(10) }, { credentials: alice });
      await harness.service.finalize({ pasteId: id }, { credentials: alice });

      const response = await harness.service.read({
        pasteId: id,
        access: { via: 'link', linkToken: linkToken as string },
      });

      expect(response.wrappedKey).toBeUndefined();
      expect(response.paste.linkEnabled).toBe(true);
    });

    it('rejects a wrong link token', async () => {
      const harness = await createHarness();
      const id = await publishPaste(harness, { overrides: { linkEnabled: true } });

      await expect(
        harness.service.read({ pasteId: id, access: { via: 'link', linkToken: 'guessed' } }),
      ).rejects.toThrow(/no longer available/);
    });

    it('rejects a link read of a paste that has no link', async () => {
      const harness = await createHarness();
      const deviceKeyId = await harness.enrollDevice('user:default/bob');
      const id = await publishPaste(harness, { deviceKeyId });

      await expect(
        harness.service.read({ pasteId: id, access: { via: 'link', linkToken: 'anything' } }),
      ).rejects.toThrow(/no longer available/);
    });

    it('reports an unknown paste the same way as a forbidden one', async () => {
      const harness = await createHarness();
      const deviceKeyId = await harness.enrollDevice('user:default/bob');

      await expect(
        harness.service.read({
          pasteId: 'AAAAAAAAAAAAAAAAAAAAAA',
          access: { via: 'recipient', userEntityRef: 'user:default/bob', deviceKeyId },
        }),
      ).rejects.toThrow(/no longer available/);
    });
  });

  describe('streamChunk', () => {
    it('returns the stored ciphertext', async () => {
      const harness = await createHarness();
      const deviceKeyId = await harness.enrollDevice('user:default/bob');
      const id = await publishPaste(harness, { deviceKeyId, chunk: Buffer.from('opaque bytes') });

      const stream = await harness.service.streamChunk({
        pasteId: id,
        index: 0,
        access: { via: 'recipient', userEntityRef: 'user:default/bob', deviceKeyId },
      });

      expect(await readAll(stream)).toEqual(Buffer.from('opaque bytes'));
    });

    it('counts a read and records who made it when the first chunk is fetched', async () => {
      const harness = await createHarness();
      const deviceKeyId = await harness.enrollDevice('user:default/bob');
      const id = await publishPaste(harness, { deviceKeyId });

      await harness.service.streamChunk({
        pasteId: id,
        index: 0,
        access: { via: 'recipient', userEntityRef: 'user:default/bob', deviceKeyId },
      });

      expect((await harness.pasteStore.getById(id))?.readCount).toBe(1);
      expect(await harness.pasteStore.listReads(id)).toEqual([
        { readerEntityRef: 'user:default/bob', via: 'recipient', readAt: expect.any(String) },
      ]);
    });

    it('does not count later chunks of the same download', async () => {
      const harness = await createHarness();
      const deviceKeyId = await harness.enrollDevice('user:default/bob');
      const { id } = await harness.service.create(
        createRequest({ wrappedKeys: [wrappedFor(deviceKeyId)], chunkCount: 2, sizeBytes: 20 }),
        { credentials: alice },
      );
      await harness.service.uploadChunk({ pasteId: id, index: 0, data: Buffer.alloc(10) }, { credentials: alice });
      await harness.service.uploadChunk({ pasteId: id, index: 1, data: Buffer.alloc(10) }, { credentials: alice });
      await harness.service.finalize({ pasteId: id }, { credentials: alice });
      const access = { via: 'recipient' as const, userEntityRef: 'user:default/bob', deviceKeyId };

      await harness.service.streamChunk({ pasteId: id, index: 0, access });
      await harness.service.streamChunk({ pasteId: id, index: 1, access });

      expect((await harness.pasteStore.getById(id))?.readCount).toBe(1);
    });

    it('refuses a chunk index the paste does not have', async () => {
      const harness = await createHarness();
      const deviceKeyId = await harness.enrollDevice('user:default/bob');
      const id = await publishPaste(harness, { deviceKeyId });

      await expect(
        harness.service.streamChunk({
          pasteId: id,
          index: 7,
          access: { via: 'recipient', userEntityRef: 'user:default/bob', deviceKeyId },
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it('lets an interrupted download be retried inside the burn grace period', async () => {
      const harness = await createHarness({ burnGracePeriodMs: 5 * MINUTE_MS });
      const deviceKeyId = await harness.enrollDevice('user:default/bob');
      const id = await publishPaste(harness, { deviceKeyId, overrides: { burnAfterRead: true } });
      const access = { via: 'recipient' as const, userEntityRef: 'user:default/bob', deviceKeyId };

      await harness.service.streamChunk({ pasteId: id, index: 0, access });

      await expect(harness.service.streamChunk({ pasteId: id, index: 0, access })).resolves.toBeDefined();
    });

    it('makes a burned paste unreadable once the grace period has passed', async () => {
      const harness = await createHarness({ burnGracePeriodMs: 0 });
      const deviceKeyId = await harness.enrollDevice('user:default/bob');
      const id = await publishPaste(harness, { deviceKeyId, overrides: { burnAfterRead: true } });
      const access = { via: 'recipient' as const, userEntityRef: 'user:default/bob', deviceKeyId };

      await harness.service.streamChunk({ pasteId: id, index: 0, access });

      await expect(harness.service.streamChunk({ pasteId: id, index: 0, access })).rejects.toThrow(
        /no longer available/,
      );
    });

    it('stops serving a paste once its read cap is reached', async () => {
      const harness = await createHarness();
      const deviceKeyId = await harness.enrollDevice('user:default/bob');
      const id = await publishPaste(harness, { deviceKeyId, overrides: { maxReads: 1 } });
      const access = { via: 'recipient' as const, userEntityRef: 'user:default/bob', deviceKeyId };

      await harness.service.streamChunk({ pasteId: id, index: 0, access });

      await expect(harness.service.streamChunk({ pasteId: id, index: 0, access })).rejects.toThrow(
        /no longer available/,
      );
    });

    it('records a link read without naming a reader', async () => {
      const harness = await createHarness();
      const { id, linkToken } = await harness.service.create(createRequest({ linkEnabled: true, sizeBytes: 10 }), {
        credentials: alice,
      });
      await harness.service.uploadChunk({ pasteId: id, index: 0, data: Buffer.alloc(10) }, { credentials: alice });
      await harness.service.finalize({ pasteId: id }, { credentials: alice });

      await harness.service.streamChunk({
        pasteId: id,
        index: 0,
        access: { via: 'link', linkToken: linkToken as string },
      });

      expect(await harness.pasteStore.listReads(id)).toEqual([
        { readerEntityRef: undefined, via: 'link', readAt: expect.any(String) },
      ]);
    });
  });

  describe('listSharedWithMe', () => {
    it('returns only the pastes wrapped for the calling device, newest first', async () => {
      const harness = await createHarness();
      const bobDevice = await harness.enrollDevice('user:default/bob');
      const otherDevice = await harness.enrollDevice('user:default/carol');
      const first = await publishPaste(harness, { deviceKeyId: bobDevice });
      const second = await publishPaste(harness, { deviceKeyId: bobDevice });
      await publishPaste(harness, { deviceKeyId: otherDevice });

      const shared = await harness.service.listSharedWithMe({ deviceKeyId: bobDevice }, { credentials: bob });

      expect(shared.map(paste => paste.id).sort()).toEqual([first, second].sort());
      expect(shared[0].wrappedKey.deviceKeyId).toBe(bobDevice);
    });

    it('honours the requested limit', async () => {
      const harness = await createHarness();
      const bobDevice = await harness.enrollDevice('user:default/bob');
      await publishPaste(harness, { deviceKeyId: bobDevice });
      await publishPaste(harness, { deviceKeyId: bobDevice });

      const shared = await harness.service.listSharedWithMe({ deviceKeyId: bobDevice, limit: 1 }, { credentials: bob });

      expect(shared).toHaveLength(1);
    });

    it('leaves out pastes that are expired, unsealed or already burned', async () => {
      const harness = await createHarness({ burnGracePeriodMs: 0 });
      const bobDevice = await harness.enrollDevice('user:default/bob');
      const expired = await publishPaste(harness, { deviceKeyId: bobDevice });
      await harness.expirePaste(expired);
      await harness.service.create(createRequest({ wrappedKeys: [wrappedFor(bobDevice)] }), { credentials: alice });
      const burned = await publishPaste(harness, { deviceKeyId: bobDevice, overrides: { burnAfterRead: true } });
      await harness.service.streamChunk({
        pasteId: burned,
        index: 0,
        access: { via: 'recipient', userEntityRef: 'user:default/bob', deviceKeyId: bobDevice },
      });

      const shared = await harness.service.listSharedWithMe({ deviceKeyId: bobDevice }, { credentials: bob });

      expect(shared).toEqual([]);
    });

    it('refuses to list for a device the caller does not own', async () => {
      const harness = await createHarness();
      const bobDevice = await harness.enrollDevice('user:default/bob');

      await expect(
        harness.service.listSharedWithMe({ deviceKeyId: bobDevice }, { credentials: alice }),
      ).rejects.toThrow(/No active device key/);
    });

    it('remembers when a device was last used', async () => {
      const harness = await createHarness();
      const bobDevice = await harness.enrollDevice('user:default/bob');

      await harness.service.listSharedWithMe({ deviceKeyId: bobDevice }, { credentials: bob });

      const [device] = await harness.deviceKeyStore.listActiveByUser('user:default/bob');
      expect(device.lastUsedAt).toEqual(expect.any(String));
    });
  });

  describe('listMine', () => {
    it('returns what the caller sent, and nothing else', async () => {
      const harness = await createHarness();
      const bobDevice = await harness.enrollDevice('user:default/bob');
      const mine = await publishPaste(harness, { deviceKeyId: bobDevice });

      expect((await harness.service.listMine({ limit: 10 }, { credentials: alice })).map(paste => paste.id)).toEqual([
        mine,
      ]);
      expect(await harness.service.listMine({ limit: 10 }, { credentials: bob })).toEqual([]);
    });
  });

  describe('listReads', () => {
    it('is visible to the sender only', async () => {
      const harness = await createHarness();
      const bobDevice = await harness.enrollDevice('user:default/bob');
      const id = await publishPaste(harness, { deviceKeyId: bobDevice });

      await expect(harness.service.listReads({ pasteId: id }, { credentials: alice })).resolves.toEqual([]);
      await expect(harness.service.listReads({ pasteId: id }, { credentials: bob })).rejects.toThrow(NotFoundError);
    });
  });

  describe('delete', () => {
    it('removes the paste and its ciphertext', async () => {
      const harness = await createHarness();
      const bobDevice = await harness.enrollDevice('user:default/bob');
      const id = await publishPaste(harness, { deviceKeyId: bobDevice });
      const storageKey = (await harness.pasteStore.getById(id))?.storageKey as string;

      await harness.service.delete({ pasteId: id }, { credentials: alice });

      expect(await harness.pasteStore.getById(id)).toBeUndefined();
      await expect(harness.blobStore.readChunk({ storageKey, index: 0 })).rejects.toThrow(NotFoundError);
    });

    it('refuses to delete somebody else paste', async () => {
      const harness = await createHarness();
      const bobDevice = await harness.enrollDevice('user:default/bob');
      const id = await publishPaste(harness, { deviceKeyId: bobDevice });

      await expect(harness.service.delete({ pasteId: id }, { credentials: bob })).rejects.toThrow(NotFoundError);
      expect(await harness.pasteStore.getById(id)).toBeDefined();
    });

    it('keeps the read trail after the paste is gone', async () => {
      const harness = await createHarness();
      const bobDevice = await harness.enrollDevice('user:default/bob');
      const id = await publishPaste(harness, { deviceKeyId: bobDevice });
      await harness.service.streamChunk({
        pasteId: id,
        index: 0,
        access: { via: 'recipient', userEntityRef: 'user:default/bob', deviceKeyId: bobDevice },
      });

      await harness.service.delete({ pasteId: id }, { credentials: alice });

      expect(await harness.pasteStore.listReads(id)).toHaveLength(1);
    });
  });
});
