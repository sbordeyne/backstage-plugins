import { ResponseErrorPanel } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import Accordion from '@material-ui/core/Accordion';
import AccordionDetails from '@material-ui/core/AccordionDetails';
import AccordionSummary from '@material-ui/core/AccordionSummary';
import Box from '@material-ui/core/Box';
import Typography from '@material-ui/core/Typography';
import { makeStyles } from '@material-ui/core/styles';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import type { BrunoResultDetail, BrunoResultListItem } from '@sbordeyne/bruno-report-type';
import { Suspense, lazy, memo, useCallback, useEffect, useRef, useState } from 'react';

import { brunoApiRef } from '../../api';
import { ResultDetailSkeleton } from '../Skeletons';
import { StatusChip } from '../StatusChip';

// Kept out of the plugin's initial chunk: it is only ever needed once a row is
// actually opened.
const BrunoReportResultView = lazy(() =>
  import('../BrunoReportResultView').then(module => ({ default: module.BrunoReportResultView })),
);

export interface ResultRowProps {
  item: BrunoResultListItem;
}

const useStyles = makeStyles(theme => ({
  accordion: {
    borderLeftWidth: 4,
    borderLeftStyle: 'solid',
  },
  pass: {
    borderLeftColor: theme.palette.success.main,
  },
  error: {
    borderLeftColor: theme.palette.error.main,
  },
  // AccordionSummary lays its content out with flex, and a flex item defaults to
  // min-width:auto — so without an explicit 0 the row refuses to shrink below the
  // widest test path and drags the whole page into a horizontal scroll.
  summary: {
    minWidth: 0,
  },
  summaryRoot: {
    minWidth: 0,
  },
  summaryContent: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1.5),
    minWidth: 0,
    width: '100%',
  },
  path: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  meta: {
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },
  details: {
    minWidth: 0,
    // A wide detail panel scrolls inside its own row rather than widening the page.
    overflowX: 'auto',
  },
}));

function ResultRowComponent({ item }: ResultRowProps): JSX.Element {
  const classes = useStyles();
  const api = useApi(brunoApiRef);

  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<BrunoResultDetail>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(false);

  const requested = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const handleChange = useCallback(
    (_event: unknown, isExpanded: boolean) => {
      setExpanded(isExpanded);
      if (!isExpanded || requested.current) {
        return;
      }
      requested.current = true;
      setLoading(true);
      api.getResult({ resultId: item.id }).then(
        loaded => {
          if (!mounted.current) {
            return;
          }
          setDetail(loaded);
          setLoading(false);
        },
        failure => {
          if (!mounted.current) {
            return;
          }
          setError(failure as Error);
          setLoading(false);
          // Allow a retry on the next expand.
          requested.current = false;
        },
      );
    },
    [api, item.id],
  );

  return (
    <Accordion
      variant="outlined"
      className={`${classes.accordion} ${item.status === 'pass' ? classes.pass : classes.error}`}
      expanded={expanded}
      onChange={handleChange}
      // The single biggest win: a collapsed row mounts only its summary.
      TransitionProps={{ unmountOnExit: true }}
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon />}
        classes={{ root: classes.summaryRoot, content: classes.summary }}
      >
        <Box className={classes.summaryContent}>
          <StatusChip status={item.status} />
          <Typography variant="body2" color="textSecondary" className={classes.meta}>
            {item.requestMethod ?? '—'}
          </Typography>
          <Typography variant="subtitle2" className={classes.path} title={item.path ?? undefined}>
            {item.path ?? item.name ?? item.testFilename ?? 'Unnamed request'}
          </Typography>
          <Typography variant="caption" color="textSecondary" className={classes.meta}>
            {item.responseStatus ?? '—'} · {item.runDurationMs ?? 0} ms
          </Typography>
        </Box>
      </AccordionSummary>

      <AccordionDetails className={classes.details}>
        {loading && <ResultDetailSkeleton />}
        {error && <ResponseErrorPanel error={error} />}
        {detail && (
          <Suspense fallback={<ResultDetailSkeleton />}>
            <BrunoReportResultView result={detail} />
          </Suspense>
        )}
      </AccordionDetails>
    </Accordion>
  );
}

export const ResultRow = memo(ResultRowComponent);
