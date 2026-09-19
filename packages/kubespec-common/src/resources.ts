import type { KubespecResourceDefinition, KubespecScope } from './schema';

export type KubespecSourceKind = 'kubernetes' | 'crd';

export type KubespecSyncStatus = 'ok' | 'partial' | 'failed';

export interface KubespecSourceSummary {
  /** URL segment and primary key, e.g. `kubernetes` or `cert-manager`. */
  slug: string;
  name: string;
  kind: KubespecSourceKind;
  repo: string;
  repoUrl: string;
  logoUrl?: string;
  versionCount: number;
  /** Absent until the source has been ingested at least once. */
  latestVersion?: string;
  lastSyncedAt?: string;
  lastSyncStatus?: KubespecSyncStatus;
}

export interface KubespecVersionSummary {
  version: string;
  /** The git tag behind the version, which may carry a project-specific prefix. */
  upstreamRef: string;
  ingestedAt: string;
  resourceCount: number;
  isLatest: boolean;
}

/**
 * Identifies one kind within one version of one source.
 *
 * `apiVersion` and `sourceVersion` are both versions and are routinely confused:
 * `apiVersion` is the Kubernetes API version (`v1`, `v1beta1`), `sourceVersion` is
 * the release of the project that served it (`v1.33`, `1.16.2`). They are spelled
 * out separately everywhere rather than sharing a `version` field.
 */
export interface KubespecResourceRef {
  /** Empty string for the core Kubernetes group. */
  group: string;
  apiVersion: string;
  /** `apps/v1`, or just `v1` for the core group. */
  apiVersionFull: string;
  kind: string;
}

/** A row on a source's index page. Never carries a schema. */
export interface KubespecResourceSummary extends KubespecResourceRef {
  /** A fixed list for Kubernetes; the API group for a CRD source. */
  category: string;
  scope: KubespecScope;
  description: string;
  propertyCount: number;
  /** Whether hand-authored examples or links exist for this kind. */
  hasMetadata: boolean;
}

/**
 * Everything about a resource except its schema.
 *
 * The schema is a separate request so that its stored gzip can be served
 * untouched; this envelope is small and is what the page paints from while the
 * tree is still in flight.
 */
export interface KubespecResourceEnvelope extends KubespecResourceSummary {
  sourceSlug: string;
  sourceName: string;
  /** The concrete release, never the `latest` alias the client may have asked for. */
  sourceVersion: string;
  isLatest: boolean;
  /** Uncompressed size of the schema, so the page can warn before a large fetch. */
  definitionBytes: number;
  definitionHash: string;
  /** The schema hit an ingest circuit breaker and is not complete. */
  truncated: boolean;
}

/** An envelope with its schema attached, as the page finally has it. */
export interface KubespecResourceDetail extends KubespecResourceEnvelope {
  definition: KubespecResourceDefinition;
}

export interface KubespecResourceListResponse {
  sourceSlug: string;
  sourceName: string;
  /** What the client asked for, which may have been `latest`. */
  requestedVersion: string;
  resolvedVersion: string;
  isLatest: boolean;
  /** Category headings in the order they should be displayed. */
  categoryOrder: string[];
  items: KubespecResourceSummary[];
}

export interface KubespecExample {
  slug: string;
  ordinal: number;
  title: string;
  description?: string;
  /** YAML, already extracted from the authored markdown. */
  content: string;
}

export interface KubespecLink {
  name: string;
  href: string;
}

export interface KubespecMetadata {
  examples: KubespecExample[];
  links: KubespecLink[];
}
