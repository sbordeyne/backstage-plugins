import type { KubespecSourceSummary } from '@sbordeyne/kubespec-common';
import { makeStyles } from '@material-ui/core/styles';
import { Link } from 'react-router-dom';

import { useKubespecRoutes } from '../../hooks';

const useStyles = makeStyles(theme => ({
  grid: {
    display: 'grid',
    // Adapts to the container instead of to a fixed column count, so a long
    // source name widens its own cell rather than being cut off.
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
    gap: theme.spacing(1),
  },
  card: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(1),
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: theme.shape.borderRadius,
    background: theme.palette.background.paper,
    color: 'inherit',
    textDecoration: 'none',
    '&:hover, &:focus-visible': {
      borderColor: theme.palette.primary.main,
      textDecoration: 'none',
    },
  },
  logo: {
    width: 24,
    height: 24,
    borderRadius: 4,
    flexShrink: 0,
    objectFit: 'contain',
  },
  fallback: {
    width: 24,
    height: 24,
    borderRadius: 4,
    flexShrink: 0,
    display: 'grid',
    placeItems: 'center',
    fontSize: '0.75rem',
    fontWeight: 700,
    background: theme.palette.background.default,
    border: `1px solid ${theme.palette.divider}`,
    color: theme.palette.text.secondary,
  },
  name: {
    fontWeight: 500,
    fontSize: '0.875rem',
    overflowWrap: 'anywhere',
  },
  version: {
    fontSize: '0.6875rem',
    color: theme.palette.text.secondary,
  },
}));

export interface SourceGridProps {
  sources: KubespecSourceSummary[];
  currentSourceId: string;
}

export function SourceGrid(props: SourceGridProps): JSX.Element | null {
  const classes = useStyles();
  const { sourceHref } = useKubespecRoutes();

  const others = props.sources
    .filter(source => source.slug !== props.currentSourceId)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (others.length === 0) {
    return null;
  }

  return (
    <div className={classes.grid}>
      {others.map(source => (
        <Link key={source.slug} to={sourceHref(source.slug)} className={classes.card}>
          {source.logoUrl ? (
            <img src={source.logoUrl} alt="" className={classes.logo} />
          ) : (
            // Sources are configured by hand and a logo is optional, so the
            // initial keeps the row aligned instead of leaving a ragged gap.
            <span className={classes.fallback} aria-hidden="true">
              {source.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span>
            <div className={classes.name}>{source.name}</div>
            {source.latestVersion && <div className={classes.version}>{source.latestVersion}</div>}
          </span>
        </Link>
      ))}
    </div>
  );
}
