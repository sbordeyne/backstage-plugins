import { NormalizedResource } from './model';
import { apiVersionMajor, compareApiVersion } from './versions';

/**
 * Keeps one API version per kind: the most mature served version within a major.
 *
 * `v1beta1` disappears once `v1` exists, while `v2beta1` stays alongside `v1`,
 * because they are different majors and a reader genuinely needs both.
 *
 * The grouping key parses the major with a digit match. kubespec.dev slices the
 * first two characters instead, so `v10alpha1` collapses into `v1` and one of the
 * two silently disappears.
 */
export function collapseToLatestApiVersions(resources: readonly NormalizedResource[]): NormalizedResource[] {
  const byKey = new Map<string, NormalizedResource>();

  for (const resource of resources) {
    const key = `${resource.group}/${apiVersionMajor(resource.version)}/${resource.kind}`;
    const existing = byKey.get(key);
    if (!existing || compareApiVersion(resource.version, existing.version) > 0) {
      byKey.set(key, resource);
    }
  }

  return [...byKey.values()].sort(
    (a, b) => a.category.localeCompare(b.category) || a.kind.localeCompare(b.kind) || a.group.localeCompare(b.group),
  );
}
