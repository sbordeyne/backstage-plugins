import type { KubespecProperty, KubespecResourceDefinition } from '@sbordeyne/kubespec-common';

import { propertyName } from './paths';

/**
 * The schema flattened into two lookups, built once per resource.
 *
 * kubespec.dev renders the tree by recursing a component into itself, which gives
 * every row its own state. At a few thousand expanded rows that makes
 * collapse-all, deep links and URL sync structurally impossible without lifting
 * the state anyway — so it is lifted from the start, and a row is identified by
 * its path rather than by its position in a component tree.
 */
export interface SchemaIndex {
  nodes: Map<string, KubespecProperty>;
  /** Parent path -> ordered child paths. The root is the empty string. */
  childrenOf: Map<string, string[]>;
  /** Every path in document order, for filtering. */
  order: string[];
}

export function buildSchemaIndex(definition: KubespecResourceDefinition): SchemaIndex {
  const nodes = new Map<string, KubespecProperty>();
  const childrenOf = new Map<string, string[]>();
  const order: string[] = [];

  const walk = (properties: readonly KubespecProperty[], parentPath: string): void => {
    const paths: string[] = [];

    for (const property of properties) {
      const path = `${parentPath}.${property.name}`;
      paths.push(path);
      nodes.set(path, property);
      order.push(path);
      if (property.children?.length) {
        walk(property.children, path);
      }
    }

    childrenOf.set(parentPath, paths);
  };

  walk(definition.properties, '');
  return { nodes, childrenOf, order };
}

export interface SchemaTreeState {
  expanded: Set<string>;
  described: Set<string>;
  focused?: string;
}

export interface PropertyRowModel {
  path: string;
  node: KubespecProperty;
  /** Indentation as a number, not as nesting. */
  depth: number;
  hasChildren: boolean;
  childCount: number;
  isExpanded: boolean;
  isDescriptionOpen: boolean;
  isFocused: boolean;
  /** For aria-setsize / aria-posinset. */
  siblingCount: number;
  positionInSet: number;
}

/** The visible rows, in document order. The only thing the tree renders. */
export function flattenTree(index: SchemaIndex, state: SchemaTreeState): PropertyRowModel[] {
  const rows: PropertyRowModel[] = [];

  const walk = (parentPath: string, depth: number): void => {
    const paths = index.childrenOf.get(parentPath) ?? [];

    paths.forEach((path, position) => {
      const node = index.nodes.get(path);
      if (!node) {
        return;
      }

      const children = index.childrenOf.get(path) ?? [];
      const isExpanded = state.expanded.has(path);

      rows.push({
        path,
        node,
        depth,
        hasChildren: children.length > 0,
        childCount: children.length,
        isExpanded,
        isDescriptionOpen: state.described.has(path),
        isFocused: state.focused === path,
        siblingCount: paths.length,
        positionInSet: position + 1,
      });

      if (isExpanded && children.length > 0) {
        walk(path, depth + 1);
      }
    });
  };

  walk('', 0);
  return rows;
}

/**
 * Which paths start expanded.
 *
 * Top-level objects open, except `metadata` — it is the same thirty fields on
 * every kind, and opening it buries the part of the schema a reader came for.
 */
export function initialExpanded(index: SchemaIndex): Set<string> {
  const expanded = new Set<string>();

  for (const path of index.childrenOf.get('') ?? []) {
    const node = index.nodes.get(path);
    if (node && (index.childrenOf.get(path)?.length ?? 0) > 0 && node.type !== 'ObjectMeta') {
      expanded.add(path);
    }
  }

  return expanded;
}

/** Every path with children, for "expand all". */
export function allExpandablePaths(index: SchemaIndex): Set<string> {
  const expanded = new Set<string>();

  for (const [path, children] of index.childrenOf) {
    if (path !== '' && children.length > 0) {
      expanded.add(path);
    }
  }

  return expanded;
}

export interface PropertyMatch {
  path: string;
  node: KubespecProperty;
  depth: number;
}

/**
 * Properties matching a filter, anywhere in the tree.
 *
 * The single biggest gap in kubespec.dev, which offers no way at all to find
 * `topologySpreadConstraints` short of opening forty nodes by hand. Matching runs
 * over the in-memory schema, so it costs no request.
 */
export function filterProperties(index: SchemaIndex, query: string, limit = 200): PropertyMatch[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) {
    return [];
  }

  const isPathQuery = needle.includes('.');
  const matches: PropertyMatch[] = [];

  for (const path of index.order) {
    if (matches.length >= limit) {
      break;
    }

    const node = index.nodes.get(path);
    if (!node) {
      continue;
    }

    if (
      propertyName(path).toLowerCase().includes(needle) ||
      node.description.toLowerCase().includes(needle) ||
      // The full path is only searched when the query looks like one. Matching it
      // unconditionally means filtering `containers` also returns everything
      // underneath it, which buries the node actually being looked for.
      (isPathQuery && path.toLowerCase().includes(needle))
    ) {
      matches.push({ path, node, depth: path.split('.').length - 2 });
    }
  }

  // Shallowest first: a match on `.spec.replicas` is far more likely to be the
  // one wanted than the same name eight levels down inside a pod template.
  return matches.sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
}
