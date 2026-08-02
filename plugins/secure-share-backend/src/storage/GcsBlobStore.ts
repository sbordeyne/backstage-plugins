import { LoggerService } from '@backstage/backend-plugin-api';
import { NotFoundError } from '@backstage/errors';
import { Bucket, Storage } from '@google-cloud/storage';
import { Readable } from 'stream';
import { BlobStore, ChunkLocation, WriteChunkOptions } from './BlobStore';
import { assertValidStorageKey, chunkFileName } from './chunkPaths';

/**
 * Stores encrypted chunks as objects in a GCS bucket, one object per chunk.
 *
 * One object per chunk rather than one per paste keeps this identical to the local
 * store: no append, no compose and no range reads to emulate.
 *
 * @public
 */
export class GcsBlobStore implements BlobStore {
  readonly #bucket: Bucket;
  readonly #prefix: string;
  readonly #logger: LoggerService;

  static create(options: {
    bucket: string;
    prefix: string;
    keyFilename?: string;
    logger: LoggerService;
  }): GcsBlobStore {
    // Without a key file the client falls back to application default credentials, which
    // is how the portal authenticates to GCP everywhere else.
    const storage = new Storage(options.keyFilename ? { keyFilename: options.keyFilename } : {});
    return new GcsBlobStore(storage.bucket(options.bucket), options.prefix, options.logger);
  }

  private constructor(bucket: Bucket, prefix: string, logger: LoggerService) {
    this.#bucket = bucket;
    this.#prefix = prefix;
    this.#logger = logger;
  }

  async writeChunk(options: WriteChunkOptions): Promise<void> {
    await this.#bucket.file(this.#objectName(options)).save(options.data, {
      resumable: false,
      contentType: 'application/octet-stream',
    });
  }

  async readChunk(options: ChunkLocation): Promise<Readable> {
    const file = this.#bucket.file(this.#objectName(options));
    const [exists] = await file.exists();
    if (!exists) {
      throw new NotFoundError(`No chunk ${options.index} stored for '${options.storageKey}'`);
    }
    return file.createReadStream();
  }

  async deleteAll(options: { storageKey: string }): Promise<void> {
    assertValidStorageKey(options.storageKey);
    await this.#bucket.deleteFiles({ prefix: this.#pastePrefix(options.storageKey), force: true });
    this.#logger.debug(`Deleted the ciphertext of '${options.storageKey}'`);
  }

  #objectName(location: ChunkLocation): string {
    return `${this.#pastePrefix(location.storageKey)}${chunkFileName(location.index)}`;
  }

  #pastePrefix(storageKey: string): string {
    assertValidStorageKey(storageKey);
    return `${this.#prefix}${storageKey}/`;
  }
}
