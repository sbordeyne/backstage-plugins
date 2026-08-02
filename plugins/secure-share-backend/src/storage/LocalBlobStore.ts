import { resolveSafeChildPath } from '@backstage/backend-plugin-api';
import { NotFoundError } from '@backstage/errors';
import { createReadStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { BlobStore, ChunkLocation, WriteChunkOptions } from './BlobStore';
import { assertValidStorageKey, chunkFileName } from './chunkPaths';

/**
 * Stores encrypted chunks as plain files under a root directory, one directory per
 * paste and one file per chunk.
 *
 * @public
 */
export class LocalBlobStore implements BlobStore {
  readonly #rootPath: string;

  static create(options: { rootPath: string }): LocalBlobStore {
    return new LocalBlobStore(path.resolve(options.rootPath));
  }

  private constructor(rootPath: string) {
    this.#rootPath = rootPath;
  }

  async writeChunk(options: WriteChunkOptions): Promise<void> {
    const chunkPath = this.#chunkPath(options);
    await fs.mkdir(path.dirname(chunkPath), { recursive: true });
    await fs.writeFile(chunkPath, options.data);
  }

  async readChunk(options: ChunkLocation): Promise<Readable> {
    const chunkPath = this.#chunkPath(options);
    try {
      await fs.access(chunkPath);
    } catch {
      throw new NotFoundError(`No chunk ${options.index} stored for '${options.storageKey}'`);
    }
    return createReadStream(chunkPath);
  }

  async deleteAll(options: { storageKey: string }): Promise<void> {
    await fs.rm(this.#pasteDirectory(options.storageKey), { recursive: true, force: true });
  }

  #chunkPath(location: ChunkLocation): string {
    return path.join(this.#pasteDirectory(location.storageKey), chunkFileName(location.index));
  }

  #pasteDirectory(storageKey: string): string {
    assertValidStorageKey(storageKey);
    return resolveSafeChildPath(this.#rootPath, storageKey);
  }
}
