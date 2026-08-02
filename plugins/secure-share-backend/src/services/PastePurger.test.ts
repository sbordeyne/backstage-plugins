import { createMockDirectory, mockServices, TestDatabases } from '@backstage/backend-test-utils';
import { NotFoundError } from '@backstage/errors';
import { randomUUID } from 'crypto';
import { Knex } from 'knex';
import path from 'path';
import { PasteStore } from '../database/PasteStore';
import { BlobStore, LocalBlobStore } from '../storage';
import { PastePurger } from './PastePurger';

const MIGRATIONS_DIRECTORY = path.resolve(__dirname, '../../migrations');
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

describe('PastePurger', () => {
  const databases = TestDatabases.create({ ids: ['SQLITE_3'] });
  const mockDir = createMockDirectory();

  interface Harness {
    purger: PastePurger;
    pasteStore: PasteStore;
    blobStore: BlobStore;
    client: Knex;
    storePaste: (overrides?: Record<string, unknown>) => Promise<{ id: string; storageKey: string }>;
  }

  async function createHarness(options: { burnGracePeriodMs?: number; blobStore?: BlobStore } = {}): Promise<Harness> {
    const client = await databases.init('SQLITE_3');
    await client.migrate.latest({ directory: MIGRATIONS_DIRECTORY });
    const pasteStore = PasteStore.create(client);
    const blobStore = options.blobStore ?? LocalBlobStore.create({ rootPath: path.join(mockDir.path, randomUUID()) });

    const storePaste = async (overrides: Record<string, unknown> = {}): Promise<{ id: string; storageKey: string }> => {
      const id = randomUUID().replace(/-/g, '').slice(0, 22);
      const storageKey = randomUUID();
      await pasteStore.insert({
        id,
        createdByEntityRef: 'user:default/alice',
        kind: 'text',
        metaCiphertext: 'sealed',
        chunkCount: 1,
        sizeBytes: 4,
        storageKey,
        expiresAt: new Date(Date.now() + HOUR_MS),
        burnAfterRead: false,
        createdAt: new Date(),
        recipientEntityRefs: [],
        wrappedKeys: [],
      });
      if (Object.keys(overrides).length > 0) {
        await client('secure_share_pastes').where({ id }).update(overrides);
      }
      await blobStore.writeChunk({ storageKey, index: 0, data: Buffer.from('ct') });
      return { id, storageKey };
    };

    return {
      pasteStore,
      blobStore,
      client,
      storePaste,
      purger: PastePurger.create({
        pastes: pasteStore,
        blobStore,
        burnGracePeriodMs: options.burnGracePeriodMs ?? 5 * MINUTE_MS,
        logger: mockServices.logger.mock(),
      }),
    };
  }

  it('deletes an expired paste and its ciphertext', async () => {
    const harness = await createHarness();
    const { id, storageKey } = await harness.storePaste({ expires_at: new Date(Date.now() - MINUTE_MS) });

    expect(await harness.purger.purge()).toBe(1);

    expect(await harness.pasteStore.getById(id)).toBeUndefined();
    await expect(harness.blobStore.readChunk({ storageKey, index: 0 })).rejects.toThrow(NotFoundError);
  });

  it('leaves a live paste alone', async () => {
    const harness = await createHarness();
    const { id } = await harness.storePaste();

    expect(await harness.purger.purge()).toBe(0);
    expect(await harness.pasteStore.getById(id)).toBeDefined();
  });

  it('deletes a burned paste once its grace period has passed', async () => {
    const harness = await createHarness({ burnGracePeriodMs: MINUTE_MS });
    const { id } = await harness.storePaste({
      burn_after_read: true,
      consumed_at: new Date(Date.now() - 2 * MINUTE_MS),
    });

    expect(await harness.purger.purge()).toBe(1);
    expect(await harness.pasteStore.getById(id)).toBeUndefined();
  });

  it('keeps a burned paste inside its grace period, so a failed download can be retried', async () => {
    const harness = await createHarness({ burnGracePeriodMs: 10 * MINUTE_MS });
    const { id } = await harness.storePaste({ burn_after_read: true, consumed_at: new Date() });

    expect(await harness.purger.purge()).toBe(0);
    expect(await harness.pasteStore.getById(id)).toBeDefined();
  });

  it('deletes a paste that reached its read cap', async () => {
    const harness = await createHarness();
    const { id } = await harness.storePaste({ max_reads: 2, read_count: 2 });

    expect(await harness.purger.purge()).toBe(1);
    expect(await harness.pasteStore.getById(id)).toBeUndefined();
  });

  it('keeps a paste that is still under its read cap', async () => {
    const harness = await createHarness();
    const { id } = await harness.storePaste({ max_reads: 2, read_count: 1 });

    expect(await harness.purger.purge()).toBe(0);
    expect(await harness.pasteStore.getById(id)).toBeDefined();
  });

  it('removes the wrapped keys and recipients of a purged paste', async () => {
    const harness = await createHarness();
    const { id } = await harness.storePaste({ expires_at: new Date(Date.now() - MINUTE_MS) });

    await harness.purger.purge();

    expect(await harness.client('secure_share_wrapped_keys').where({ paste_id: id })).toEqual([]);
    expect(await harness.client('secure_share_paste_chunks').where({ paste_id: id })).toEqual([]);
  });

  it('keeps the row when the ciphertext cannot be deleted, so the next run retries', async () => {
    const failingBlobStore: BlobStore = {
      writeChunk: jest.fn(),
      readChunk: jest.fn(),
      deleteAll: jest.fn().mockRejectedValue(new Error('bucket unreachable')),
    };
    const harness = await createHarness({ blobStore: failingBlobStore });
    const { id } = await harness.storePaste({ expires_at: new Date(Date.now() - MINUTE_MS) });

    expect(await harness.purger.purge()).toBe(0);
    expect(await harness.pasteStore.getById(id)).toBeDefined();
  });
});
