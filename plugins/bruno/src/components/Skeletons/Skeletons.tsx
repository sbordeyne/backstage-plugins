import Box from '@material-ui/core/Box';
import Grid from '@material-ui/core/Grid';
import Skeleton from '@material-ui/lab/Skeleton';

import { STAT_CARD_HEIGHT } from '../BrunoReportSummaryView';

/**
 * Every skeleton below reproduces the exact geometry of what replaces it, so the
 * page never shifts when data lands.
 */

/** Matches a collapsed AccordionSummary (MUI v4 min-height) plus its gap. */
export const RESULT_ROW_HEIGHT = 48;
const SUMMARY_TABLE_HEIGHT = 148;

export function SummarySkeleton(): JSX.Element {
  return (
    <>
      <Box px={2} pb={2} pt={1}>
        <Grid container spacing={2} justifyContent="center">
          {[0, 1, 2, 3].map(index => (
            <Grid item xs={12} sm={6} md={3} key={index}>
              <Skeleton variant="rect" height={STAT_CARD_HEIGHT} />
            </Grid>
          ))}
        </Grid>
      </Box>
      <Skeleton variant="rect" height={SUMMARY_TABLE_HEIGHT} />
    </>
  );
}

export function ResultRowsSkeleton(props: { rows: number }): JSX.Element {
  return (
    <Box display="flex" flexDirection="column" gridGap={8}>
      {Array.from({ length: props.rows }, (_, index) => (
        <Skeleton key={index} variant="rect" height={RESULT_ROW_HEIGHT} animation="wave" />
      ))}
    </Box>
  );
}

export function ResultDetailSkeleton(): JSX.Element {
  return (
    <Box width="100%" display="flex" flexDirection="column" gridGap={16}>
      <Skeleton variant="rect" height={120} animation="wave" />
      <Skeleton variant="rect" height={200} animation="wave" />
    </Box>
  );
}
