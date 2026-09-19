import type { KubespecChange, KubespecScope, KubespecSourceKind, KubespecSyncStatus } from '@sbordeyne/kubespec-common';

import type { FlatProperty } from '../kube/flatten';

export interface SourceRecord {
  slug: string;
  name: string;
  kind: KubespecSourceKind;
  repo: string;
  logoUrl?: string;
  displayOrder: number;
}

/** A version already in the database, as the ingest planner sees it. */
export interface StoredVersion {
  id: string;
  version: string;
  upstreamRef: string;
  sortKey: string;
  contentHash: string;
  state: 'ingesting' | 'ready' | 'failed';
  isLatest: boolean;
}

export interface NewVersion {
  sourceSlug: string;
  version: string;
  upstreamRef: string;
  sortKey: string;
  contentHash: string;
  sourceBytes: number;
}

export interface NewResource {
  apiGroup: string;
  apiVersion: string;
  apiVersionFull: string;
  kind: string;
  category: string;
  scope: KubespecScope;
  description: string;
  propertyCount: number;
  treeDepth: number;
  definitionGzip: Buffer;
  definitionBytes: number;
  definitionHash: string;
  truncated: boolean;
  /** Empty when this version is not being indexed for property search. */
  properties: FlatProperty[];
}

export interface NewChangeSummary {
  apiGroup: string;
  apiVersion: string;
  kind: string;
  previousVersionId?: string;
  isNewGvk: boolean;
  isRemovedGvk: boolean;
  addedCount: number;
  removedCount: number;
  descriptionChangedCount: number;
  descriptionChangedPaths: number;
  typeChangedCount: number;
  typeChangedPaths: number;
  changes: KubespecChange[];
}

/** Everything one version contributes, written in a single transaction. */
export interface IngestVersionInput {
  version: NewVersion;
  resources: NewResource[];
  summaries: NewChangeSummary[];
}

export interface ResourceKey {
  apiGroup: string;
  apiVersion: string;
  kind: string;
}

export interface StoredDefinition extends ResourceKey {
  id: string;
  definitionGzip: Buffer;
}

export interface SourceSyncOutcome {
  status: KubespecSyncStatus;
  error?: string;
  tagsEtag?: string;
}

export interface MetadataEntry {
  sourceSlug: string;
  apiVersionFull: string;
  kindLower: string;
  slug: string;
  ordinal: number;
  title: string;
  description?: string;
  content: string;
  contentHash: string;
}

export interface MetadataLinkEntry {
  sourceSlug: string;
  apiVersionFull: string;
  kindLower: string;
  ordinal: number;
  name: string;
  href: string;
}
