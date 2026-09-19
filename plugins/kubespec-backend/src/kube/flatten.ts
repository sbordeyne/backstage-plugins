import type { KubespecProperty, KubespecResourceDefinition } from '@sbordeyne/kubespec-common';

/** One row of the flat property index that backs property search. */
export interface FlatProperty {
  seq: number;
  path: string;
  name: string;
  type: string;
  isArray: boolean;
  required: boolean;
  depth: number;
  description: string;
}

export interface FlattenOptions {
  /** Properties deeper than this are not indexed. Depth 0 is a top-level property. */
  maxDepth: number;
  /** Descriptions are truncated before indexing; the tree keeps the full text. */
  maxDescriptionLength?: number;
}

const DEFAULT_MAX_DESCRIPTION = 500;

/**
 * Walks a stored schema into index rows, in document order.
 *
 * `seq` is the ordinal, which doubles as the keyset cursor — it is stable for a
 * given stored blob, and the blob is immutable once written.
 */
export function flattenDefinition(definition: KubespecResourceDefinition, options: FlattenOptions): FlatProperty[] {
  const maxDescription = options.maxDescriptionLength ?? DEFAULT_MAX_DESCRIPTION;
  const rows: FlatProperty[] = [];

  const walk = (properties: readonly KubespecProperty[], parentPath: string, depth: number): void => {
    if (depth > options.maxDepth) {
      return;
    }
    for (const property of properties) {
      const path = `${parentPath}.${property.name}`;
      rows.push({
        seq: rows.length,
        path,
        name: property.name,
        type: property.type,
        isArray: property.isArray,
        required: property.required,
        depth,
        description:
          property.description.length <= maxDescription
            ? property.description
            : `${property.description.slice(0, maxDescription - 1)}…`,
      });
      if (property.children) {
        walk(property.children, path, depth + 1);
      }
    }
  };

  walk(definition.properties, '', 0);
  return rows;
}

/** Every property in document order, keyed by path. Used by the diff. */
export function indexByPath(definition: KubespecResourceDefinition): Map<string, KubespecProperty> {
  const index = new Map<string, KubespecProperty>();

  const walk = (properties: readonly KubespecProperty[], parentPath: string): void => {
    for (const property of properties) {
      const path = `${parentPath}.${property.name}`;
      index.set(path, property);
      if (property.children) {
        walk(property.children, path);
      }
    }
  };

  walk(definition.properties, '');
  return index;
}
