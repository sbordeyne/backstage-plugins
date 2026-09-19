import { makeStyles } from '@material-ui/core/styles';
import Tooltip from '@material-ui/core/Tooltip';

const useStyles = makeStyles(theme => ({
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '1px 6px',
    borderRadius: 10,
    border: `1px solid ${theme.palette.divider}`,
    fontSize: '0.6875rem',
    lineHeight: 1.6,
    whiteSpace: 'nowrap',
    color: theme.palette.text.secondary,
    background: theme.palette.background.default,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: 'currentColor',
  },
}));

export interface ScopeBadgeProps {
  scope: 'Cluster' | 'Namespaced';
  /**
   * `compact` shows the badge only for cluster-scoped kinds, which is the
   * exception worth flagging on a dense grid; `full` always labels the scope.
   */
  variant?: 'compact' | 'full';
}

/**
 * Whether a kind lives in a namespace or across the cluster.
 *
 * Spelled out rather than shown as a bare glyph: the distinction decides whether
 * `metadata.namespace` applies at all, which is not something to leave to a
 * symbol a reader has to learn.
 */
export function ScopeBadge({ scope, variant = 'full' }: ScopeBadgeProps): JSX.Element | null {
  const classes = useStyles();

  if (variant === 'compact' && scope !== 'Cluster') {
    // Namespaced is the overwhelming default; labelling every card with it adds
    // noise without telling a reader anything.
    return null;
  }

  const label = scope === 'Cluster' ? 'Cluster-scoped resource' : 'Namespaced resource';

  return (
    <Tooltip title={label}>
      <span className={classes.badge} aria-label={label}>
        <span className={classes.dot} aria-hidden="true" />
        {scope === 'Cluster' ? 'Cluster' : 'Namespaced'}
      </span>
    </Tooltip>
  );
}
