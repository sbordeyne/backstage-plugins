import type { KubespecResourceDefinition } from '@sbordeyne/kubespec-common';
import { createHash } from 'crypto';
import { gunzipSync, gzipSync } from 'zlib';

export interface SerializedDefinition {
  gzip: Buffer;
  /** Uncompressed length, which is what a reader's payload budget cares about. */
  bytes: number;
  /** sha256 of the uncompressed JSON, served as the resource's ETag. */
  hash: string;
}

/**
 * Serializes a schema once, at ingest.
 *
 * These bytes are the wire bytes: the router sends the stored buffer under
 * `Content-Encoding: gzip` without touching it, so serving a schema costs a row
 * read and nothing else. The hash is taken over the uncompressed JSON so it stays
 * stable even if a future Node changes its deflate output.
 */
export function serializeDefinition(definition: KubespecResourceDefinition): SerializedDefinition {
  const json = JSON.stringify(definition);
  return {
    gzip: gzipSync(json),
    bytes: Buffer.byteLength(json, 'utf-8'),
    hash: createHash('sha256').update(json).digest('hex'),
  };
}

export function deserializeDefinition(gzip: Buffer): KubespecResourceDefinition {
  return JSON.parse(gunzipSync(gzip).toString('utf-8')) as KubespecResourceDefinition;
}
