import { GetObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';

import { matchesRequiredSegment } from './objectPath';
import type { BrunoArtifactRef, BrunoArtifactSource, BrunoSourceType } from './types';

export interface S3SourceOptions {
  bucket: string;
  prefix: string;
  requiredPathSegment: string;
}

export class S3ArtifactSource implements BrunoArtifactSource {
  readonly type: BrunoSourceType = 's3';

  readonly #client: S3Client;
  readonly #options: S3SourceOptions;

  constructor(options: S3SourceOptions, client: S3Client) {
    this.#options = options;
    this.#client = client;
  }

  async *list(abortSignal?: AbortSignal): AsyncIterable<BrunoArtifactRef> {
    let continuationToken: string | undefined;

    do {
      const page = await this.#client.send(
        new ListObjectsV2Command({
          Bucket: this.#options.bucket,
          Prefix: this.#options.prefix,
          ContinuationToken: continuationToken,
        }),
        { abortSignal },
      );

      for (const object of page.Contents ?? []) {
        if (abortSignal?.aborted) {
          return;
        }
        if (!object.Key || object.Key.endsWith('/')) {
          continue;
        }
        if (!matchesRequiredSegment(object.Key, this.#options.requiredPathSegment)) {
          continue;
        }
        yield this.toRef(object.Key, object.ETag, object.LastModified, object.Size);
      }

      continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuationToken);
  }

  async download(ref: BrunoArtifactRef): Promise<Buffer> {
    // S3 has no generation to pin, so the ETag listed is asserted instead: an
    // object overwritten between listing and downloading fails with a 412
    // rather than storing new bytes under the old version, and the next tick
    // picks it up as the new run it is.
    const response = await this.#client.send(
      new GetObjectCommand({
        Bucket: this.#options.bucket,
        Key: ref.name,
        IfMatch: ref.etag,
      }),
    );

    if (!response.Body) {
      throw new Error(`S3 object '${ref.name}' returned no body`);
    }
    return Buffer.from(await response.Body.transformToByteArray());
  }

  private toRef(key: string, etag?: string, lastModified?: Date, size?: number): BrunoArtifactRef {
    // The quotes are part of the header value, not of the identity.
    const unquotedEtag = etag?.replace(/^"|"$/g, '');
    return {
      source: `s3://${this.#options.bucket}`,
      name: key,
      version: unquotedEtag ?? '',
      etag,
      createdAt: lastModified ?? new Date(0),
      sizeBytes: size,
    };
  }
}
