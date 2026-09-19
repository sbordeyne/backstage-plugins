import { makeStyles, useTheme } from '@material-ui/core/styles';

import { getPropertyTypePalette } from '../../lib/propertyTypePalette';
import type { PropertyRowModel } from '../../lib/schemaTree';
import { PropertyTypeLabel } from '../PropertyTypeLabel';

const useStyles = makeStyles(theme => ({
  row: {
    display: 'flex',
    alignItems: 'baseline',
    gap: theme.spacing(1),
    padding: `${theme.spacing(0.25)}px 0`,
    // Most of virtualization's paint saving for one declaration, and unlike
    // virtualization it leaves the browser's own find-in-page working.
    contentVisibility: 'auto',
    containIntrinsicSize: 'auto 28px',
  },
  focused: {
    outline: '2px solid currentColor',
    outlineOffset: 2,
    borderRadius: 2,
  },
  chevron: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    width: 16,
    fontSize: '0.7rem',
    lineHeight: 1,
    color: 'inherit',
  },
  spacer: {
    width: 16,
    display: 'inline-block',
  },
  name: {
    fontFamily: 'var(--bui-font-mono, monospace)',
    fontSize: '0.8125rem',
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    color: 'inherit',
    textAlign: 'left',
  },
  typeButton: {
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
  },
  count: {
    fontSize: '0.75rem',
  },
  anchor: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    fontSize: '0.75rem',
    opacity: 0,
    '$row:hover &': { opacity: 1 },
    '&:focus': { opacity: 1 },
  },
  description: {
    fontSize: '0.8125rem',
    whiteSpace: 'pre-wrap',
    margin: `${theme.spacing(0.5)}px 0 ${theme.spacing(1)}px 0`,
  },
}));

export interface PropertyRowProps {
  model: PropertyRowModel;
  scope: 'Cluster' | 'Namespaced';
  onToggleChildren: (path: string) => void;
  onToggleDescription: (path: string) => void;
  onCopyLink: (path: string) => void;
}

/**
 * One property.
 *
 * Presentational and stateless: every toggle lives in the tree's reducer, keyed
 * by path. Indentation is a number rather than nesting, which is what lets the
 * whole tree be one flat list of `treeitem`s.
 */
export function PropertyRow(props: PropertyRowProps): JSX.Element {
  const { model, scope } = props;
  const classes = useStyles();
  const theme = useTheme();
  const palette = getPropertyTypePalette(theme.palette.type === 'dark');

  // `metadata.namespace` is required in practice on a namespaced kind, even
  // though no schema says so.
  const isRequired = model.node.required || (scope === 'Namespaced' && model.path === '.metadata.namespace');

  const descriptionId = `${model.path}-description`;

  return (
    <div
      role="treeitem"
      aria-level={model.depth + 1}
      aria-expanded={model.hasChildren ? model.isExpanded : undefined}
      aria-setsize={model.siblingCount}
      aria-posinset={model.positionInSet}
      aria-selected={model.isFocused}
      data-path={model.path}
      style={{
        marginLeft: model.depth * 16,
        borderLeft: model.depth > 0 ? `1px solid ${palette.guide}` : undefined,
        paddingLeft: model.depth > 0 ? 8 : 0,
      }}
    >
      <div className={`${classes.row} ${model.isFocused ? classes.focused : ''}`}>
        {model.hasChildren ? (
          <button
            type="button"
            className={classes.chevron}
            aria-label={`${model.isExpanded ? 'Collapse' : 'Expand'} ${model.node.name}`}
            onClick={() => props.onToggleChildren(model.path)}
          >
            {model.isExpanded ? '▼' : '▶'}
          </button>
        ) : (
          <span className={classes.spacer} />
        )}

        <button
          type="button"
          className={classes.name}
          aria-expanded={model.isDescriptionOpen}
          aria-controls={descriptionId}
          onClick={() => props.onToggleDescription(model.path)}
        >
          {model.node.name}
          {isRequired && <span style={{ color: palette.required }}> *</span>}
        </button>

        <button
          type="button"
          className={classes.typeButton}
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => model.hasChildren && props.onToggleChildren(model.path)}
        >
          <PropertyTypeLabel type={model.node.type} isArray={model.node.isArray} hasChildren={model.hasChildren} />
        </button>

        {model.hasChildren && (
          <span className={classes.count} style={{ color: palette.muted }}>
            ({model.childCount})
          </span>
        )}

        {model.node.recursiveOf !== undefined && (
          <span className={classes.count} style={{ color: palette.recursive }}>
            recursive — same shape as {model.node.recursiveOf}
          </span>
        )}

        <button
          type="button"
          className={classes.anchor}
          style={{ color: palette.muted }}
          aria-label={`Copy a link to ${model.path}`}
          onClick={() => props.onCopyLink(model.path)}
        >
          #
        </button>
      </div>

      {model.isDescriptionOpen && (
        <div id={descriptionId} className={classes.description} style={{ color: palette.muted }}>
          {model.node.description || 'No description.'}
          {model.node.enumValues && <div>One of: {model.node.enumValues.join(', ')}</div>}
          {model.node.defaultValue !== undefined && <div>Default: {model.node.defaultValue}</div>}
          {model.node.format && <div>Format: {model.node.format}</div>}
          {model.node.preserveUnknownFields && <div>Accepts fields this schema does not describe.</div>}
        </div>
      )}
    </div>
  );
}
