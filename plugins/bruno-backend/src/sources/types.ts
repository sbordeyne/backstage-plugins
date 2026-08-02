/** Where a source reads artifacts from. */
export type BrunoSourceType = 'gcs' | 's3' | 'github';

export interface BrunoArtifactRef {
  /** The container the artifact lives in: `gs://bucket`, `s3://bucket`, `github://owner/repo`. */
  source: string;
  /**
   * Path of the artifact within its container. Only the last `/` segment is matched against the
   * report annotation, so a source with no real path — a GitHub artifact — yields a bare name.
   */
  name: string;
  /**
   * Immutable per-write token the sync diffs on: a GCS generation, an S3 version id or ETag, a
   * GitHub artifact id. Two artifacts with the same name and different versions are two runs.
   */
  version: string;
  etag?: string;
  createdAt: Date;
  sizeBytes?: number;
}

/**
 * The worker talks to this rather than to a cloud SDK directly, so it can be exercised without
 * credentials of any kind, and so a new backing store is one more implementation rather than a
 * change to the sync.
 *
 * A source owns its own locator configuration — bucket and prefix, or repository and filters — so
 * nothing in the worker has to know which kind it is holding.
 */
export interface BrunoArtifactSource {
  readonly type: BrunoSourceType;
  list(abortSignal?: AbortSignal): AsyncIterable<BrunoArtifactRef>;
  /** The artifact's bytes: the report JSON itself, unwrapped from any archive the source uses. */
  download(ref: BrunoArtifactRef): Promise<Buffer>;
}
