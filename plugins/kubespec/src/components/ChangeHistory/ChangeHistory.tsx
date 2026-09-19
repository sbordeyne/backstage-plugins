import { useApi } from '@backstage/core-plugin-api';
import { Accordion, AccordionGroup, AccordionPanel, AccordionTrigger, Flex, Text } from '@backstage/ui';
import type { KubespecChange, KubespecChangeSummary } from '@sbordeyne/kubespec-common';
import { makeStyles } from '@material-ui/core/styles';
import { useCallback, useState } from 'react';

import { kubespecApiRef } from '../../api';
import type { ResourceRef } from '../../lib/paths';
import { DescriptionDiff } from '../DescriptionDiff';

const useStyles = makeStyles(theme => ({
  path: {
    background: 'none',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    fontFamily: 'var(--bui-font-mono, monospace)',
    fontSize: '0.8125rem',
    color: 'inherit',
    textAlign: 'left',
  },
  detail: {
    margin: `${theme.spacing(0.5)}px 0 ${theme.spacing(1)}px ${theme.spacing(2)}px`,
  },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: 0,
  },
  /** A release with nothing in it: same row, no disclosure, no panel. */
  quiet: {
    display: 'flex',
    alignItems: 'baseline',
    gap: theme.spacing(2),
    padding: theme.spacing(1, 0),
    borderBottom: `1px solid ${theme.palette.divider}`,
  },
}));

interface EntryState {
  loading: boolean;
  changes?: KubespecChange[];
  error?: Error;
}

export interface ChangeHistoryProps {
  /** Not named `ref`: React reserves that prop and it would never arrive. */
  resource: ResourceRef;
  sourceName: string;
  summaries: KubespecChangeSummary[];
  /** Expands the tree at a path and scrolls to it. */
  onNavigateToPath: (path: string) => void;
}

function hasChanges(summary: KubespecChangeSummary): boolean {
  return (
    summary.isNewGvk ||
    summary.isRemovedGvk ||
    summary.addedCount + summary.removedCount + summary.descriptionChangedCount + summary.typeChangedCount > 0
  );
}

/**
 * What changed in this kind, release by release.
 *
 * Every ingested release gets a row, so the reader can see the version they are
 * on and how far back the history goes. Only a release that actually changed
 * something is expandable — an accordion that opens onto "no schema changes" is
 * a disclosure that discloses nothing.
 *
 * The counters arrive with the summary request, so the whole timeline paints
 * before anything is opened; only an opened release fetches its change list.
 */
export function ChangeHistory(props: ChangeHistoryProps): JSX.Element | null {
  const api = useApi(kubespecApiRef);
  const classes = useStyles();
  const [entries, setEntries] = useState<Record<string, EntryState>>({});

  const open = useCallback(
    async (version: string) => {
      if (entries[version]) {
        return;
      }
      setEntries(current => ({ ...current, [version]: { loading: true } }));
      try {
        const page = await api.listChanges({ ref: { ...props.resource, sourceVersion: version }, limit: 200 });
        setEntries(current => ({ ...current, [version]: { loading: false, changes: page.items } }));
      } catch (error) {
        setEntries(current => ({ ...current, [version]: { loading: false, error: error as Error } }));
      }
    },
    [api, entries, props.resource],
  );

  if (props.summaries.length === 0) {
    return null;
  }

  return (
    <Flex direction="column" gap="2">
      <Text as="h3" variant="title-small">
        Change history
      </Text>

      <AccordionGroup allowsMultiple onExpandedChange={keys => [...keys].forEach(key => open(String(key)))}>
        {props.summaries.map(summary =>
          hasChanges(summary) ? (
            <Accordion key={summary.version} id={summary.version}>
              <AccordionTrigger title={`${props.sourceName} ${summary.version}`}>
                <Counters summary={summary} />
              </AccordionTrigger>
              <AccordionPanel>
                <EntryBody
                  summary={summary}
                  state={entries[summary.version]}
                  onNavigateToPath={props.onNavigateToPath}
                />
              </AccordionPanel>
            </Accordion>
          ) : (
            <div key={summary.version} className={classes.quiet}>
              <Text variant="body-medium">
                {props.sourceName} {summary.version}
              </Text>
              <Text variant="body-small" color="secondary">
                no changes
              </Text>
            </div>
          ),
        )}
      </AccordionGroup>
    </Flex>
  );
}

function Counters({ summary }: { summary: KubespecChangeSummary }): JSX.Element {
  if (summary.isNewGvk) {
    return (
      <Text variant="body-small" color="info">
        first appeared
      </Text>
    );
  }
  if (summary.isRemovedGvk) {
    return (
      <Text variant="body-small" color="danger">
        removed
      </Text>
    );
  }

  const modified = summary.descriptionChangedCount + summary.typeChangedCount;

  return (
    <Flex gap="2" align="center">
      {summary.addedCount > 0 && (
        <Text variant="body-small" color="success" weight="bold">
          +{summary.addedCount}
        </Text>
      )}
      {summary.removedCount > 0 && (
        <Text variant="body-small" color="danger" weight="bold">
          −{summary.removedCount}
        </Text>
      )}
      {modified > 0 && (
        <Text variant="body-small" color="warning" weight="bold">
          ~{modified}
        </Text>
      )}
    </Flex>
  );
}

function EntryBody(props: {
  summary: KubespecChangeSummary;
  state?: EntryState;
  onNavigateToPath: (path: string) => void;
}): JSX.Element {
  const classes = useStyles();
  const { summary, state } = props;

  if (summary.isNewGvk) {
    return (
      <Text variant="body-small" color="secondary">
        This kind was introduced in {summary.version}.
      </Text>
    );
  }

  if (!state || state.loading) {
    return (
      <Text variant="body-small" color="secondary">
        Loading…
      </Text>
    );
  }

  if (state.error) {
    return (
      <Text variant="body-small" color="danger">
        {state.error.message}
      </Text>
    );
  }

  return (
    <Flex direction="column" gap="2">
      {summary.descriptionChangedPaths > summary.descriptionChangedCount && (
        <Text variant="body-small" color="secondary">
          {summary.descriptionChangedPaths} descriptions changed, across {summary.descriptionChangedCount} distinct
          edits — one edit to a shared type reaches every property that embeds it.
        </Text>
      )}
      <ul className={classes.list}>
        {(state.changes ?? []).map(change => (
          <li key={`${change.changeType}:${change.path}`}>
            <ChangeRow change={change} onNavigateToPath={props.onNavigateToPath} />
          </li>
        ))}
      </ul>
    </Flex>
  );
}

const CHANGE_MARKERS: Record<KubespecChange['changeType'], string> = {
  new: '+',
  removed: '−',
  description: '~',
  type: '~',
};

function ChangeRow(props: { change: KubespecChange; onNavigateToPath: (path: string) => void }): JSX.Element {
  const classes = useStyles();
  const [open, setOpen] = useState(false);
  const { change } = props;

  return (
    <div>
      <Flex gap="2" align="center">
        <button type="button" className={classes.path} aria-expanded={open} onClick={() => setOpen(!open)}>
          {CHANGE_MARKERS[change.changeType]} {change.path}
          {change.pathCount > 1 ? ` (+${change.pathCount - 1} more)` : ''}
        </button>
        <button
          type="button"
          className={classes.path}
          aria-label={`Show ${change.path} in the schema`}
          onClick={() => props.onNavigateToPath(change.path)}
        >
          → tree
        </button>
      </Flex>

      {open && (
        <div className={classes.detail}>
          {change.diff ? (
            <DescriptionDiff spans={change.diff} />
          ) : (
            <Text variant="body-small" color="secondary">
              {change.changeType === 'type'
                ? `${change.previousValue} → ${change.nextValue}`
                : change.description || 'No description.'}
            </Text>
          )}
          {change.paths && change.paths.length > 1 && (
            <Text variant="body-small" color="secondary">
              Also at: {change.paths.slice(1).join(', ')}
            </Text>
          )}
        </div>
      )}
    </div>
  );
}
