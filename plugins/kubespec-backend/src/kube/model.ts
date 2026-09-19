import type { KubespecResourceDefinition, KubespecScope } from '@sbordeyne/kubespec-common';

/** One resource as it leaves a normalizer, before it is collapsed and stored. */
export interface NormalizedResource {
  group: string;
  version: string;
  kind: string;
  /** `apps/v1`, or just `v1` for the core group. */
  apiVersionFull: string;
  category: string;
  scope: KubespecScope;
  definition: KubespecResourceDefinition;
  propertyCount: number;
  treeDepth: number;
  /** An expansion limit stopped the walk; the stored schema is incomplete. */
  truncated: boolean;
}

export interface ExpansionLimits {
  maxNodes: number;
  maxDepth: number;
}

export const DEFAULT_EXPANSION_LIMITS: ExpansionLimits = {
  maxNodes: 50_000,
  maxDepth: 20,
};

/**
 * Bounds one resource's expansion.
 *
 * A pathological schema — a deeply self-embedding CRD, or an upstream type that
 * grows without bound — must degrade to a truncated tree rather than exhaust the
 * heap and fail the whole version's import.
 */
export class ExpansionBudget {
  private nodes = 0;
  private deepest = 0;
  private hitLimit = false;

  constructor(private readonly limits: ExpansionLimits = DEFAULT_EXPANSION_LIMITS) {}

  /** Records one property node. False once the budget is spent. */
  claim(depth: number): boolean {
    if (this.nodes >= this.limits.maxNodes) {
      this.hitLimit = true;
      return false;
    }
    this.nodes += 1;
    if (depth > this.deepest) {
      this.deepest = depth;
    }
    return true;
  }

  /** Whether children at this depth may still be expanded. */
  canDescend(depth: number): boolean {
    if (depth >= this.limits.maxDepth) {
      this.hitLimit = true;
      return false;
    }
    return this.nodes < this.limits.maxNodes;
  }

  get count(): number {
    return this.nodes;
  }

  get depth(): number {
    return this.deepest;
  }

  get truncated(): boolean {
    return this.hitLimit;
  }
}

export function apiVersionFull(group: string, version: string): string {
  return group ? `${group}/${version}` : version;
}

/**
 * Descriptions are stored twice — inside the schema blob and, truncated, on the
 * searchable rows. Only the latter is capped: a truncated description inside the
 * tree would be a visible regression against the upstream docs.
 */
export function truncate(value: string | undefined, max: number): string {
  if (!value) {
    return '';
  }
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

export function buildDefinition(
  description: string,
  properties: KubespecResourceDefinition['properties'],
): KubespecResourceDefinition {
  return { description, properties };
}
