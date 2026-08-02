import { EmptyState, InfoCard, ResponseErrorPanel } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import Box from '@material-ui/core/Box';
import Button from '@material-ui/core/Button';
import Typography from '@material-ui/core/Typography';
import { makeStyles } from '@material-ui/core/styles';
import ToggleButton from '@material-ui/lab/ToggleButton';
import ToggleButtonGroup from '@material-ui/lab/ToggleButtonGroup';
import type { BrunoResultStatus } from '@sbordeyne/bruno-report-type';
import { useCallback, useRef, useState } from 'react';

import { brunoApiRef } from '../../api';
import { useCursorList, useIntersectionSentinel } from '../../hooks';
import { ResultRow } from '../ResultRow';
import { ResultRowsSkeleton } from '../Skeletons';

const PAGE_SIZE = 50;
/**
 * Bounds how much the list can grow without a deliberate click, so a run with
 * thousands of results cannot auto-load itself into an unusable DOM.
 */
const MAX_AUTOMATIC_PAGES = 10;
const APPENDING_SKELETON_ROWS = 3;

export interface ResultsSectionProps {
  runId?: string;
  expectedResultCount?: number;
}

type StatusFilter = 'all' | BrunoResultStatus;

const useStyles = makeStyles(theme => ({
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing(2),
    flexWrap: 'wrap',
    marginBottom: theme.spacing(2),
  },
  rows: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(1),
    // Rows are flex items, which default to min-width:auto and would otherwise
    // be sized by their longest test path rather than by the card.
    minWidth: 0,
    '& > *': {
      minWidth: 0,
    },
  },
  footer: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    gap: theme.spacing(1),
    padding: theme.spacing(2, 0),
  },
  sentinel: {
    width: 1,
    height: 1,
  },
}));

export function ResultsSection({ runId, expectedResultCount }: ResultsSectionProps): JSX.Element {
  const classes = useStyles();
  const api = useApi(brunoApiRef);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const automaticPages = useRef(0);

  const fetchPage = useCallback(
    async ({ cursor, limit, signal }: { cursor?: string; limit: number; signal: AbortSignal }) => {
      if (!runId) {
        return { items: [], nextCursor: undefined };
      }
      return api.listResults({
        runId,
        limit,
        cursor,
        status: statusFilter === 'all' ? undefined : statusFilter,
        signal,
      });
    },
    [api, runId, statusFilter],
  );

  const list = useCursorList(fetchPage, {
    key: `${runId ?? 'none'}:${statusFilter}`,
    limit: PAGE_SIZE,
    enabled: Boolean(runId),
  });

  const handleAutomaticLoad = useCallback(() => {
    if (automaticPages.current >= MAX_AUTOMATIC_PAGES) {
      return;
    }
    automaticPages.current += 1;
    list.loadMore();
  }, [list]);

  const sentinelRef = useIntersectionSentinel(handleAutomaticLoad, {
    disabled: !list.hasMore || list.loading || automaticPages.current >= MAX_AUTOMATIC_PAGES,
    // IntersectionObserver only fires on transitions, so the observer has to be
    // rebuilt whenever the list grows.
    deps: list.items.length,
  });

  const handleManualLoad = useCallback(() => {
    automaticPages.current = 0;
    list.loadMore();
  }, [list]);

  return (
    <InfoCard title="Test results">
      <div className={classes.toolbar}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={statusFilter}
          onChange={(_event, value: StatusFilter | null) => value && setStatusFilter(value)}
          aria-label="Filter results by status"
        >
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="error">Failed only</ToggleButton>
        </ToggleButtonGroup>

        <Typography variant="body2" color="textSecondary">
          {list.totalCount === undefined
            ? `${list.items.length} shown`
            : `Showing ${list.items.length} of ${list.totalCount}`}
        </Typography>
      </div>

      {list.error && <ResponseErrorPanel error={list.error} />}

      {list.initialLoading && <ResultRowsSkeleton rows={Math.min(Math.max(expectedResultCount ?? 8, 1), 8)} />}

      {!list.initialLoading && !list.error && list.items.length === 0 && (
        <EmptyState
          missing="data"
          title="No test results"
          description={
            statusFilter === 'error' ? 'Every request in this run passed.' : 'This run recorded no requests.'
          }
        />
      )}

      <div className={classes.rows}>
        {list.items.map(item => (
          <ResultRow key={item.id} item={item} />
        ))}
      </div>

      {list.loading && list.items.length > 0 && (
        <Box mt={1}>
          <ResultRowsSkeleton rows={APPENDING_SKELETON_ROWS} />
        </Box>
      )}

      {list.hasMore && list.items.length > 0 && (
        <div className={classes.footer}>
          <div ref={sentinelRef} className={classes.sentinel} aria-hidden />
          {/* Always present: the fallback when IntersectionObserver never fires,
              and the handle tests use to paginate. */}
          <Button variant="outlined" onClick={handleManualLoad} disabled={list.loading}>
            {list.loading ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </InfoCard>
  );
}
