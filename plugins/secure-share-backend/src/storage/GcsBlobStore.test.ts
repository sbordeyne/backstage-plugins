import { mockServices } from '@backstage/backend-test-utils';
import { NotFoundError } from '@backstage/errors';
import { Readable } from 'stream';
import { GcsBlobStore } from './GcsBlobStore';

const save = jest.fn();
const exists = jest.fn();
const createReadStream = jest.fn();
const file = jest.fn();
const deleteFiles = jest.fn();
const bucket = jest.fn();
const storageConstructor = jest.fn();

jest.mock('@google-cloud/storage', () => ({
  Storage: class {
    constructor(options: unknown) {
      storageConstructor(options);
    }

    bucket(name: string) {
      bucket(name);
      return { file, deleteFiles };
    }
  },
}));

describe('GcsBlobStore', () => {
  const storageKey = 'PkR3xQ9tLmA1';

  function createStore(options: { keyFilename?: string; prefix?: string } = {}): GcsBlobStore {
    return GcsBlobStore.create({
      bucket: 'example-secure-share',
      prefix: options.prefix ?? 'pastes/',
      keyFilename: options.keyFilename,
      logger: mockServices.logger.mock(),
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    file.mockReturnValue({ save, exists, createReadStream });
    exists.mockResolvedValue([true]);
    createReadStream.mockReturnValue(Readable.from([Buffer.from('ciphertext')]));
  });

  it('falls back to application default credentials when no key file is configured', () => {
    createStore();

    expect(storageConstructor).toHaveBeenCalledWith({});
    expect(bucket).toHaveBeenCalledWith('example-secure-share');
  });

  it('uses a service account key file when one is configured', () => {
    createStore({ keyFilename: '/secrets/gcs.json' });

    expect(storageConstructor).toHaveBeenCalledWith({ keyFilename: '/secrets/gcs.json' });
  });

  it('writes one object per chunk, under the configured prefix', async () => {
    const store = createStore();

    await store.writeChunk({ storageKey, index: 3, data: Buffer.from('ciphertext') });

    expect(file).toHaveBeenCalledWith(`pastes/${storageKey}/3.bin`);
    expect(save).toHaveBeenCalledWith(Buffer.from('ciphertext'), {
      resumable: false,
      contentType: 'application/octet-stream',
    });
  });

  it('streams a chunk back', async () => {
    const store = createStore();

    const stream = await store.readChunk({ storageKey, index: 0 });

    expect(file).toHaveBeenCalledWith(`pastes/${storageKey}/0.bin`);
    expect(stream).toBeDefined();
  });

  it('throws NotFoundError when the object is missing', async () => {
    exists.mockResolvedValue([false]);
    const store = createStore();

    await expect(store.readChunk({ storageKey, index: 0 })).rejects.toThrow(NotFoundError);
    expect(createReadStream).not.toHaveBeenCalled();
  });

  it('deletes every chunk of a paste by prefix', async () => {
    const store = createStore();

    await store.deleteAll({ storageKey });

    expect(deleteFiles).toHaveBeenCalledWith({ prefix: `pastes/${storageKey}/`, force: true });
  });

  it('honours an empty prefix', async () => {
    const store = createStore({ prefix: '' });

    await store.writeChunk({ storageKey, index: 0, data: Buffer.from('x') });

    expect(file).toHaveBeenCalledWith(`${storageKey}/0.bin`);
  });

  it.each(['../escape', 'nested/key', 'with space', ''])('refuses the storage key %p', async invalidKey => {
    const store = createStore();

    await expect(store.writeChunk({ storageKey: invalidKey, index: 0, data: Buffer.alloc(1) })).rejects.toThrow(
      /Invalid storage key/,
    );
    expect(save).not.toHaveBeenCalled();
  });

  it.each([-1, 1.5])('refuses the chunk index %p', async invalidIndex => {
    const store = createStore();

    await expect(store.readChunk({ storageKey, index: invalidIndex })).rejects.toThrow(/Invalid chunk index/);
  });
});
