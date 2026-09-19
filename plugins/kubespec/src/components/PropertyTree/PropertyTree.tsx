import { Button, Flex, SearchField, Text } from '@backstage/ui';
import { makeStyles, useTheme } from '@material-ui/core/styles';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import type { SchemaTree } from '../../hooks';
import { getPropertyTypePalette } from '../../lib/propertyTypePalette';
import { filterProperties } from '../../lib/schemaTree';
import { PropertyLegend } from '../PropertyLegend';
import { PropertyRow } from '../PropertyRow';

const useStyles = makeStyles(theme => ({
  panel: {
    borderRadius: 8,
    padding: theme.spacing(2),
  },
  tree: {
    marginTop: theme.spacing(1),
  },
  match: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: `${theme.spacing(0.5)}px 0`,
    fontFamily: 'var(--bui-font-mono, monospace)',
    fontSize: '0.8125rem',
    textAlign: 'left',
    color: 'inherit',
    display: 'block',
    width: '100%',
  },
}));

export interface PropertyTreeProps {
  tree: SchemaTree;
  scope: 'Cluster' | 'Namespaced';
  /** Bound to `?q=` so a filtered view can be shared and survives a reload. */
  query: string;
  onQueryChange: (query: string) => void;
  onCopyLink: (path: string) => void;
}

/**
 * The schema, as an ARIA tree.
 *
 * kubespec.dev renders nested lists of click handlers with no roles at all; a
 * flat row model makes a real tree widget nearly free, so keyboard users get
 * arrow-key navigation and screen readers get the structure.
 */
export function PropertyTree(props: PropertyTreeProps): JSX.Element {
  const { tree, query } = props;
  const classes = useStyles();
  const theme = useTheme();
  const palette = getPropertyTypePalette(theme.palette.type === 'dark');
  const containerRef = useRef<HTMLDivElement | null>(null);

  const matches = useMemo(() => filterProperties(tree.index, query), [tree.index, query]);
  const isFiltering = query.trim().length > 0;

  // Scroll a deep-linked property into view once its row exists.
  useEffect(() => {
    if (!tree.focused || isFiltering) {
      return;
    }
    const row = containerRef.current?.querySelector(`[data-path="${CSS.escape(tree.focused)}"]`);
    row?.scrollIntoView({ block: 'center' });
  }, [tree.focused, isFiltering]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const path = (event.target as HTMLElement).closest('[data-path]')?.getAttribute('data-path');
      if (!path) {
        return;
      }

      const row = tree.rows.find(candidate => candidate.path === path);
      if (!row) {
        return;
      }

      if (event.key === 'ArrowRight' && row.hasChildren && !row.isExpanded) {
        event.preventDefault();
        tree.toggleChildren(path);
      } else if (event.key === 'ArrowLeft' && row.isExpanded) {
        event.preventDefault();
        tree.toggleChildren(path);
      }
    },
    [tree],
  );

  return (
    <Flex direction="column" gap="3">
      <Flex gap="2" align="center">
        <SearchField
          aria-label="Filter properties"
          placeholder="Filter properties…"
          value={query}
          onChange={props.onQueryChange}
        />
        <Button variant="secondary" size="small" onClick={tree.expandAll}>
          Expand all
        </Button>
        <Button variant="secondary" size="small" onClick={tree.collapseAll}>
          Collapse all
        </Button>
      </Flex>

      <div
        className={classes.panel}
        style={{ background: palette.surface, border: `1px solid ${palette.border}` }}
        ref={containerRef}
      >
        {isFiltering ? (
          <Flex direction="column" gap="1">
            <Text variant="body-small" color="secondary">
              {matches.length === 0
                ? `Nothing matches “${query}”.`
                : `${matches.length} propert${matches.length === 1 ? 'y' : 'ies'} match “${query}”.`}
            </Text>
            {matches.map(match => (
              <button
                key={match.path}
                type="button"
                className={classes.match}
                onClick={() => {
                  // Clearing the filter first means the tree is showing again by
                  // the time the focused row is scrolled to.
                  props.onQueryChange('');
                  tree.focusPath(match.path);
                }}
              >
                <span>{match.path}</span>{' '}
                <span style={{ color: palette.muted }}>
                  {match.node.type}
                  {match.node.isArray ? '[]' : ''}
                </span>
              </button>
            ))}
          </Flex>
        ) : (
          <div role="tree" aria-label="Properties" className={classes.tree} onKeyDown={onKeyDown} tabIndex={0}>
            {tree.rows.map(row => (
              <PropertyRow
                key={row.path}
                model={row}
                scope={props.scope}
                onToggleChildren={tree.toggleChildren}
                onToggleDescription={tree.toggleDescription}
                onCopyLink={props.onCopyLink}
              />
            ))}
          </div>
        )}
      </div>

      <PropertyLegend />
    </Flex>
  );
}
