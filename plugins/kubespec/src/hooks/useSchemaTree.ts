import type { KubespecResourceDefinition } from '@sbordeyne/kubespec-common';
import { useCallback, useMemo, useReducer, useRef } from 'react';

import { ancestorPaths } from '../lib/paths';
import {
  PropertyRowModel,
  SchemaIndex,
  allExpandablePaths,
  buildSchemaIndex,
  flattenTree,
  initialExpanded,
} from '../lib/schemaTree';

interface State {
  expanded: Set<string>;
  described: Set<string>;
  focused?: string;
}

type Action =
  | { type: 'reset'; index: SchemaIndex; focusedPath?: string }
  | { type: 'toggleChildren'; path: string }
  | { type: 'toggleDescription'; path: string }
  | { type: 'expandAll'; index: SchemaIndex }
  | { type: 'collapseAll' }
  | { type: 'focus'; path: string };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'reset': {
      const expanded = initialExpanded(action.index);
      if (action.focusedPath) {
        // Only the ancestors are opened, and they come from splitting the path —
        // no walk, and no request, because the whole schema is already here.
        for (const path of ancestorPaths(action.focusedPath)) {
          if (path) {
            expanded.add(path);
          }
        }
      }
      return {
        expanded,
        described: action.focusedPath ? new Set([action.focusedPath]) : new Set(),
        focused: action.focusedPath,
      };
    }
    case 'toggleChildren': {
      const expanded = new Set(state.expanded);
      if (!expanded.delete(action.path)) {
        expanded.add(action.path);
      }
      return { ...state, expanded };
    }
    case 'toggleDescription': {
      const described = new Set(state.described);
      if (!described.delete(action.path)) {
        described.add(action.path);
      }
      return { ...state, described };
    }
    case 'expandAll':
      return { ...state, expanded: allExpandablePaths(action.index) };
    case 'collapseAll':
      return { ...state, expanded: new Set() };
    case 'focus': {
      const expanded = new Set(state.expanded);
      for (const path of ancestorPaths(action.path)) {
        if (path) {
          expanded.add(path);
        }
      }
      return { expanded, described: new Set(state.described).add(action.path), focused: action.path };
    }
    default:
      return state;
  }
}

export interface SchemaTree {
  index: SchemaIndex;
  rows: PropertyRowModel[];
  focused?: string;
  toggleChildren: (path: string) => void;
  toggleDescription: (path: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  /** Opens every ancestor of a path and marks it as the one to scroll to. */
  focusPath: (path: string) => void;
}

const EMPTY_DEFINITION: KubespecResourceDefinition = { description: '', properties: [] };

/**
 * Expand/collapse state for one resource's schema.
 *
 * The whole schema is in memory — a resource is 12 KB compressed at the median
 * and 200 KB at the worst in the entire corpus — so expanding, collapsing,
 * filtering and deep-link expansion are all synchronous. There is no lazy
 * subtree protocol because there is nothing large enough to justify one.
 */
export function useSchemaTree(definition: KubespecResourceDefinition | undefined, focusedPath?: string): SchemaTree {
  const index = useMemo(() => buildSchemaIndex(definition ?? EMPTY_DEFINITION), [definition]);

  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    expanded: new Set<string>(),
    described: new Set<string>(),
  }));

  // Reset during render rather than in an effect, so switching resources never
  // paints the previous one's expansion state for a frame.
  const lastIndex = useRef<SchemaIndex | undefined>(undefined);
  if (lastIndex.current !== index) {
    lastIndex.current = index;
    dispatch({ type: 'reset', index, focusedPath });
  }

  const rows = useMemo(() => flattenTree(index, state), [index, state]);

  return {
    index,
    rows,
    focused: state.focused,
    toggleChildren: useCallback((path: string) => dispatch({ type: 'toggleChildren', path }), []),
    toggleDescription: useCallback((path: string) => dispatch({ type: 'toggleDescription', path }), []),
    expandAll: useCallback(() => dispatch({ type: 'expandAll', index }), [index]),
    collapseAll: useCallback(() => dispatch({ type: 'collapseAll' }), []),
    focusPath: useCallback((path: string) => dispatch({ type: 'focus', path }), []),
  };
}
