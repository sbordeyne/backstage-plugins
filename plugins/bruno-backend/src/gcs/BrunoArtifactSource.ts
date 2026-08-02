import * as storage from '@google-cloud/storage';

export interface BrunoArtifactRef {
  bucket: string;
  name: string;
  /** GCS's immutable per-write version id — the correct change-detection token. */
  generation: string;
  etag?: string;
  createdAt: Date;
  sizeBytes?: number;
}

/**
 * The worker talks to this rather than to `@google-cloud/storage` directly, so it
 * can be exercised without Application Default Credentials.
 */
export interface BrunoArtifactSource {
  list(prefix: string): AsyncIterable<BrunoArtifactRef>;
  download(ref: BrunoArtifactRef): Promise<Buffer>;
}

export class GcsArtifactSource implements BrunoArtifactSource {
  readonly #bucket: storage.Bucket;
  readonly #bucketName: string;

  constructor(bucketName: string, client: storage.Storage = new storage.Storage()) {
    this.#bucketName = bucketName;
    this.#bucket = client.bucket(bucketName);
  }

  async *list(prefix: string): AsyncIterable<BrunoArtifactRef> {
    // No `fields` projection here: restricting it stops the client from
    // populating File#metadata at all, which leaves every object without the
    // generation the sync diffs on.
    const stream = this.#bucket.getFilesStream({ prefix, autoPaginate: true });

    for await (const file of stream as AsyncIterable<storage.File>) {
      yield this.toRef(file);
    }
  }

  async download(ref: BrunoArtifactRef): Promise<Buffer> {
    // Pinning the generation closes the race where the object is overwritten
    // between listing and downloading, which would store new bytes under the old
    // generation and suppress the next sync.
    const [contents] = await this.#bucket.file(ref.name, { generation: ref.generation }).download();
    return contents;
  }

  private toRef(file: storage.File): BrunoArtifactRef {
    const metadata = file.metadata ?? {};
    return {
      bucket: this.#bucketName,
      name: file.name,
      generation: String(metadata.generation ?? ''),
      etag: metadata.etag,
      createdAt: metadata.timeCreated ? new Date(metadata.timeCreated) : new Date(0),
      sizeBytes: metadata.size === undefined ? undefined : Number(metadata.size),
    };
  }
}
