import type { TagRules } from '../config';
import { compareStrings, compareVersions, isPrerelease, parseVersion, versionSortKey } from '../kube/versions';

export interface SelectedTag {
  /** The git tag as upstream publishes it. */
  tag: string;
  /** What a reader sees, after any configured prefix is stripped. */
  version: string;
  sortKey: string;
}

/**
 * Applies a project's declarative tag rules to the tags a repository publishes.
 *
 * The order is load-bearing and is the same one documented in `config.d.ts`:
 *
 *   exclude (raw tag) -> prefix (required, stripped) -> regex (on the remainder)
 *   -> parse -> excludePrerelease -> minVersion/maxVersion -> sort -> max
 *
 * `prefix` has to be stripped before anything else looks at the tag, because for
 * a project like vertical-pod-autoscaler the version only exists *after* the
 * prefix comes off (`vertical-pod-autoscaler-chart-1.2.3`).
 *
 * Nothing here throws. An unparseable tag is dropped, never propagated: this runs
 * inside the ingest loop, and a single odd tag in a repository with hundreds must
 * not take the project down.
 */
export function selectTags(tags: readonly string[], rules: TagRules): SelectedTag[] {
  const exclude = compileRegex(rules.exclude);
  const include = compileRegex(rules.regex);

  const selected: SelectedTag[] = [];

  for (const tag of tags) {
    if (exclude?.test(tag)) {
      continue;
    }

    let remainder = tag;
    if (rules.prefix) {
      if (!tag.startsWith(rules.prefix)) {
        continue;
      }
      remainder = tag.slice(rules.prefix.length);
    }

    if (include && !include.test(remainder)) {
      continue;
    }

    const parsed = parseVersion(remainder);
    if (!parsed) {
      continue;
    }
    if (rules.excludePrerelease && isPrerelease(remainder)) {
      continue;
    }
    if (rules.minVersion && compareVersions(remainder, rules.minVersion) < 0) {
      continue;
    }
    if (rules.maxVersion && compareVersions(remainder, rules.maxVersion) > 0) {
      continue;
    }

    selected.push({ tag, version: remainder, sortKey: versionSortKey(remainder) });
  }

  // Newest first, with the tag as a tie-break so the order is deterministic.
  selected.sort((a, b) => compareStrings(b.sortKey, a.sortKey) || a.tag.localeCompare(b.tag));

  // Some repositories publish a release under two spellings — Cilium ships both
  // `1.20.1` and `v1.20.1`. They normalize to one version, and ingesting it twice
  // would store the same schemas under two indistinguishable entries.
  const deduped: SelectedTag[] = [];
  const seen = new Set<string>();
  for (const candidate of selected) {
    if (seen.has(candidate.version)) {
      continue;
    }
    seen.add(candidate.version);
    deduped.push(candidate);
  }

  return rules.max > 0 ? deduped.slice(0, rules.max) : deduped;
}

/** Patterns are validated when the config is read, so this cannot throw here. */
function compileRegex(pattern?: string): RegExp | undefined {
  return pattern ? new RegExp(pattern) : undefined;
}
