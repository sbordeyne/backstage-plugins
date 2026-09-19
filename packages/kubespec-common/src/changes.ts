export type KubespecChangeType = 'new' | 'removed' | 'description' | 'type';

/** One run of a word-level description diff, precomputed at ingest. */
export interface KubespecDiffSpan {
  value: string;
  kind: 'equal' | 'added' | 'removed';
}

/**
 * Counters for one version of one resource, relative to the version before it.
 *
 * `descriptionChangedCount` counts distinct edits while `descriptionChangedPaths`
 * counts the paths they touch, and the two differ wildly: one edit to a shared
 * type's doc comment reappears at every path that embeds it. Showing only the
 * path count (as kubespec.dev does) reports a thousand changes where there was
 * one.
 */
export interface KubespecChangeSummary {
  version: string;
  /** Absent on the oldest ingested version of a source. */
  previousVersion?: string;
  isNewGvk: boolean;
  isRemovedGvk: boolean;
  addedCount: number;
  removedCount: number;
  descriptionChangedCount: number;
  descriptionChangedPaths: number;
  typeChangedCount: number;
  typeChangedPaths: number;
}

export interface KubespecChange {
  changeType: KubespecChangeType;
  /** The shortest affected path when this edit touches several. */
  path: string;
  pathCount: number;
  /** Present when `pathCount > 1`; capped, so it can be shorter than the count. */
  paths?: string[];
  depth: number;
  /** For `new` and `removed`. */
  description?: string;
  /** For `description` and `type`. */
  previousValue?: string;
  nextValue?: string;
  /** For `description`: the precomputed word diff of the two values. */
  diff?: KubespecDiffSpan[];
}
