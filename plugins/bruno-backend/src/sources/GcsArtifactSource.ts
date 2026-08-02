import * as storage from '@google-cloud/storage';

import { matchesRequiredSegment } from './objectPath';
import type { BrunoArtifactRef, BrunoArtifactSource, BrunoSourceType } from './types';

export interface GcsSourceOptions {
  bucket: string;
  prefix: string;
  requiredPathSegment: string;
}

export class GcsArtifactSource implements BrunoArtifactSource {
  readonly type: BrunoSourceType = 'gcs';

  readonly #bucket: storage.Bucket;
  readonly #options: GcsSourceOptions;

  constructor(options: GcsSourceOptions, client: storage.Storage = new storage.Storage()) {
    this.#options = options;
    this.#bucket = client.bucket(options.bucket);
  }

  async *list(abortSignal?: AbortSignal): AsyncIterable<BrunoArtifactRef> {
    // No `fields` projection here: restricting it stops the client from
    // populating File#metadata at all, which leaves every object without the
    // generation the sync diffs on.
    const stream = this.#bucket.getFilesStream({ prefix: this.#options.prefix, autoPaginate: true });

    for await (const file of stream as AsyncIterable<storage.File>) {
      if (abortSignal?.aborted) {
        break;
      }
      if (!matchesRequiredSegment(file.name, this.#options.requiredPathSegment)) {
        continue;
      }
      yield this.toRef(file);
    }
  }

  async download(ref: BrunoArtifactRef): Promise<Buffer> {
    // Pinning the generation closes the race where the object is overwritten
    // between listing and downloading, which would store new bytes under the old
    // generation and suppress the next sync.
    const [contents] = await this.#bucket.file(ref.name, { generation: ref.version }).download();
    return contents;
  }

  private toRef(file: storage.File): BrunoArtifactRef {
    const metadata = file.metadata ?? {};
    return {
      source: `gs://${this.#options.bucket}`,
      name: file.name,
      version: String(metadata.generation ?? ''),
      etag: metadata.etag,
      createdAt: metadata.timeCreated ? new Date(metadata.timeCreated) : new Date(0),
      sizeBytes: metadata.size === undefined ? undefined : Number(metadata.size),
    };
  }
}
