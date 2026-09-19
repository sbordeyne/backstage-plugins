import type { KubespecResourceSummary } from '@sbordeyne/kubespec-common';
import { makeStyles } from '@material-ui/core/styles';
import { Link } from 'react-router-dom';

import { ScopeBadge } from '../ScopeBadge';

const useStyles = makeStyles(theme => ({
  card: {
    display: 'block',
    position: 'relative',
    height: '100%',
    padding: theme.spacing(1, 1.5),
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
  apiVersion: {
    fontSize: '0.6875rem',
    color: theme.palette.text.secondary,
    // Long CRD groups such as `karpenter.k8s.aws/v1` must wrap rather than be
    // clipped: the group is half of what identifies the kind.
    overflowWrap: 'anywhere',
  },
  kind: {
    fontWeight: 600,
    fontSize: '0.875rem',
    overflowWrap: 'anywhere',
  },
  badge: {
    marginTop: theme.spacing(0.5),
  },
}));

export interface ResourceCardProps {
  resource: KubespecResourceSummary;
  href: string;
}

export function ResourceCard(props: ResourceCardProps): JSX.Element {
  const classes = useStyles();
  const { resource } = props;

  return (
    <Link to={props.href} className={classes.card}>
      <div className={classes.apiVersion}>{resource.apiVersionFull}</div>
      <div className={classes.kind}>{resource.kind}</div>
      <div className={classes.badge}>
        <ScopeBadge scope={resource.scope} variant="compact" />
      </div>
    </Link>
  );
}
