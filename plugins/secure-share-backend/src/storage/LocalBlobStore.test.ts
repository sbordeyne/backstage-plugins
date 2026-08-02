import { createMockDirectory } from '@backstage/backend-test-utils';
import { NotFoundError } from '@backstage/errors';
import fs from 'fs/promises';
import path from 'path';
import { LocalBlobStore } from './LocalBlobStore';

describe('LocalBlobStore', () => {
  const mockDir = createMockDirectory();
  const storageKey = 'PkR3xQ9tLmA1';

  beforeEach(() => {
    mockDir.clear();
  });

  function createStore(): LocalBlobStore {
    return LocalBlobStore.create({ rootPath: mockDir.path });
  }

  async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  it('reads back a written chunk', async () => {
    const store = createStore();
    const data = Buffer.from('ciphertext');

    await store.writeChunk({ storageKey, index: 0, data });

    expect(await readAll(await store.readChunk({ storageKey, index: 0 }))).toEqual(data);
  });

  it('keeps chunks of the same paste apart', async () => {
    const store = createStore();

    await store.writeChunk({ storageKey, index: 0, data: Buffer.from('first') });
    await store.writeChunk({ storageKey, index: 1, data: Buffer.from('second') });

    expect(await readAll(await store.readChunk({ storageKey, index: 1 }))).toEqual(Buffer.from('second'));
  });

  it('throws NotFoundError for a chunk that was never written', async () => {
    const store = createStore();

    await expect(store.readChunk({ storageKey, index: 3 })).rejects.toThrow(NotFoundError);
  });

  it('deletes every chunk of a paste', async () => {
    const store = createStore();
    await store.writeChunk({ storageKey, index: 0, data: Buffer.from('first') });
    await store.writeChunk({ storageKey, index: 1, data: Buffer.from('second') });

    await store.deleteAll({ storageKey });

    await expect(fs.access(path.join(mockDir.path, storageKey))).rejects.toThrow();
  });

  it('is a no-op when deleting a paste that has no chunks', async () => {
    const store = createStore();

    await expect(store.deleteAll({ storageKey })).resolves.toBeUndefined();
  });

  it.each(['../escape', 'nested/key', 'with space', '', 'a'.repeat(65)])(
    'refuses the storage key %p',
    async invalidKey => {
      const store = createStore();

      await expect(store.writeChunk({ storageKey: invalidKey, index: 0, data: Buffer.alloc(1) })).rejects.toThrow(
        /Invalid storage key/,
      );
    },
  );

  it.each([-1, 1.5, Number.NaN])('refuses the chunk index %p', async invalidIndex => {
    const store = createStore();

    await expect(store.readChunk({ storageKey, index: invalidIndex })).rejects.toThrow(/Invalid chunk index/);
  });
});
