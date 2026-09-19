import type {
  KubespecChange,
  KubespecChangeType,
  KubespecDiffSpan,
  KubespecProperty,
  KubespecResourceDefinition,
} from '@sbordeyne/kubespec-common';
import { createHash } from 'crypto';
import { diffWords } from 'diff';

/** Paths listed on a grouped change. The count stays exact regardless. */
const MAX_LISTED_PATHS = 200;
const MAX_DIFF_SPANS = 500;

export interface DiffCounts {
  addedCount: number;
  removedCount: number;
  descriptionChangedCount: number;
  descriptionChangedPaths: number;
  typeChangedCount: number;
  typeChangedPaths: number;
}

export interface DiffResult extends DiffCounts {
  changes: KubespecChange[];
}

interface RawChange {
  changeType: KubespecChangeType;
  path: string;
  depth: number;
  description?: string;
  previousValue?: string;
  nextValue?: string;
}

/**
 * Compares two versions of one resource's schema.
 *
 * Three departures from kubespec.dev:
 *
 * - A changed description no longer stops the walk. The original only recursed
 *   into a property whose description was unchanged, so every change beneath an
 *   edited node was invisible.
 * - Type changes are reported. `string` becoming `IntOrString` is a breaking
 *   change that the original never surfaced at all.
 * - Description and type changes are grouped by the edit rather than the path.
 *   One edit to a shared type's doc comment appears at every path embedding it —
 *   measured at 1,403 paths for a single prometheus-operator release — and
 *   listing them individually buries the handful of changes that matter.
 */
export function diffDefinitions(previous: KubespecResourceDefinition, next: KubespecResourceDefinition): DiffResult {
  const raw: RawChange[] = [];
  walk(previous.properties, next.properties, '', 0, raw);
  return group(raw);
}

function walk(
  previous: readonly KubespecProperty[],
  next: readonly KubespecProperty[],
  parentPath: string,
  depth: number,
  out: RawChange[],
): void {
  const previousByName = new Map(previous.map(property => [property.name, property]));
  const nextByName = new Map(next.map(property => [property.name, property]));

  for (const property of next) {
    const path = `${parentPath}.${property.name}`;
    const before = previousByName.get(property.name);

    if (!before) {
      // Reported at its root only: listing every descendant of a new object turns
      // one addition into hundreds of lines.
      out.push({ changeType: 'new', path, depth, description: property.description });
      continue;
    }

    const beforeType = typeLabel(before);
    const afterType = typeLabel(property);
    if (beforeType !== afterType) {
      out.push({ changeType: 'type', path, depth, previousValue: beforeType, nextValue: afterType });
    }

    if (before.description !== property.description) {
      out.push({
        changeType: 'description',
        path,
        depth,
        previousValue: before.description,
        nextValue: property.description,
      });
    }

    // Always descends, whether or not this node itself changed.
    walk(before.children ?? [], property.children ?? [], path, depth + 1, out);
  }

  for (const property of previous) {
    if (!nextByName.has(property.name)) {
      out.push({
        changeType: 'removed',
        path: `${parentPath}.${property.name}`,
        depth,
        description: property.description,
      });
    }
  }
}

function typeLabel(property: KubespecProperty): string {
  return property.isArray ? `${property.type}[]` : property.type;
}

const CHANGE_TYPE_ORDER: KubespecChangeType[] = ['new', 'removed', 'description', 'type'];

function group(raw: readonly RawChange[]): DiffResult {
  const singles: KubespecChange[] = [];
  const grouped = new Map<string, { sample: RawChange; paths: string[] }>();

  for (const change of raw) {
    if (change.changeType === 'new' || change.changeType === 'removed') {
      singles.push({
        changeType: change.changeType,
        path: change.path,
        pathCount: 1,
        depth: change.depth,
        description: change.description,
      });
      continue;
    }

    // JSON rather than a delimiter: the values are free text, and any separator
    // they could contain would collide two unrelated edits into one row.
    const key = createHash('sha1')
      .update(JSON.stringify([change.changeType, change.previousValue, change.nextValue]))
      .digest('hex');

    const existing = grouped.get(key);
    if (existing) {
      existing.paths.push(change.path);
      // The shallowest path is the one a reader can actually place, so it is what
      // the grouped row shows.
      if (change.depth < existing.sample.depth) {
        existing.sample = change;
      }
    } else {
      grouped.set(key, { sample: change, paths: [change.path] });
    }
  }

  const multiples: KubespecChange[] = [...grouped.values()].map(({ sample, paths }) => {
    const sorted = [...paths].sort();
    const change: KubespecChange = {
      changeType: sample.changeType,
      path: sample.path,
      pathCount: sorted.length,
      depth: sample.depth,
      previousValue: sample.previousValue,
      nextValue: sample.nextValue,
    };
    if (sorted.length > 1) {
      change.paths = sorted.slice(0, MAX_LISTED_PATHS);
    }
    if (sample.changeType === 'description') {
      change.diff = wordDiff(sample.previousValue ?? '', sample.nextValue ?? '');
    }
    return change;
  });

  const changes = [...singles, ...multiples].sort(
    (a, b) =>
      CHANGE_TYPE_ORDER.indexOf(a.changeType) - CHANGE_TYPE_ORDER.indexOf(b.changeType) ||
      b.pathCount - a.pathCount ||
      a.path.localeCompare(b.path),
  );

  return { changes, ...count(changes) };
}

function count(changes: readonly KubespecChange[]): DiffCounts {
  const counts: DiffCounts = {
    addedCount: 0,
    removedCount: 0,
    descriptionChangedCount: 0,
    descriptionChangedPaths: 0,
    typeChangedCount: 0,
    typeChangedPaths: 0,
  };

  for (const change of changes) {
    switch (change.changeType) {
      case 'new':
        counts.addedCount += 1;
        break;
      case 'removed':
        counts.removedCount += 1;
        break;
      case 'description':
        counts.descriptionChangedCount += 1;
        counts.descriptionChangedPaths += change.pathCount;
        break;
      case 'type':
        counts.typeChangedCount += 1;
        counts.typeChangedPaths += change.pathCount;
        break;
      default:
        break;
    }
  }

  return counts;
}

/**
 * The word-level diff of two descriptions, computed once here rather than once
 * per reader in the browser: the result is a constant of the two stored strings.
 */
export function wordDiff(previous: string, next: string): KubespecDiffSpan[] {
  const spans: KubespecDiffSpan[] = [];

  for (const part of diffWords(previous, next)) {
    if (spans.length >= MAX_DIFF_SPANS) {
      break;
    }
    spans.push({ value: part.value, kind: spanKind(part) });
  }

  return spans;
}

function spanKind(part: { added?: boolean; removed?: boolean }): KubespecDiffSpan['kind'] {
  if (part.added) {
    return 'added';
  }
  return part.removed ? 'removed' : 'equal';
}
