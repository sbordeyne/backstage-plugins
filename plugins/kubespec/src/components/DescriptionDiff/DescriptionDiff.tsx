import type { KubespecDiffSpan } from '@sbordeyne/kubespec-common';
import { makeStyles } from '@material-ui/core/styles';

const useStyles = makeStyles({
  /** `equal` has no class of its own, so an unchanged run renders unstyled. */
  equal: {},
  added: {
    background: 'var(--bui-positive-bg-subdued)',
    color: 'var(--bui-positive-fg-subdued)',
  },
  removed: {
    background: 'var(--bui-negative-bg-subdued)',
    color: 'var(--bui-negative-fg-subdued)',
    textDecoration: 'line-through',
  },
  text: {
    fontSize: '0.8125rem',
    whiteSpace: 'pre-wrap',
  },
});

export interface DescriptionDiffProps {
  spans: KubespecDiffSpan[];
}

/**
 * A word-level description diff.
 *
 * The spans arrive precomputed: the result is a constant of the two stored
 * strings, so it is produced once at ingest rather than once per reader — which
 * also keeps a diffing library out of the app bundle.
 */
export function DescriptionDiff({ spans }: DescriptionDiffProps): JSX.Element {
  const classes = useStyles();

  return (
    <span className={classes.text}>
      {spans.map((span, index) => (
        <span
          // Spans have no identity of their own; their position is what they are.
          // eslint-disable-next-line react/no-array-index-key
          key={index}
          className={classes[span.kind as 'added' | 'removed']}
        >
          {span.value}
        </span>
      ))}
    </span>
  );
}
