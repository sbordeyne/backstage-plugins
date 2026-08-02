import { Readable } from 'stream';

/** @public */
export interface ChunkLocation {
  storageKey: string;
  index: number;
}

/** @public */
export interface WriteChunkOptions extends ChunkLocation {
  data: Buffer;
}

/**
 * Stores the encrypted chunks of a paste payload.
 *
 * Implementations only ever see ciphertext: the data key that produced it is never
 * sent to the backend. One object per chunk keeps every backend identical, with no
 * range reads or append semantics to emulate.
 *
 * @public
 */
export interface BlobStore {
  writeChunk(options: WriteChunkOptions): Promise<void>;
  readChunk(options: ChunkLocation): Promise<Readable>;
  deleteAll(options: { storageKey: string }): Promise<void>;
}
