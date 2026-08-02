import { InfoCard, Table, TableColumn } from '@backstage/core-components';
import Box from '@material-ui/core/Box';
import Grid from '@material-ui/core/Grid';
import Paper from '@material-ui/core/Paper';
import Typography from '@material-ui/core/Typography';
import { makeStyles } from '@material-ui/core/styles';
import CancelOutlinedIcon from '@material-ui/icons/CancelOutlined';
import CheckCircleOutlineIcon from '@material-ui/icons/CheckCircleOutline';
import type { BrunoRunSummary } from '@sbordeyne/bruno-report-type';
import { memo, useMemo } from 'react';

export interface BrunoReportSummaryViewProps {
  run: BrunoRunSummary;
}

interface SummaryRow {
  item: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number | string;
  error: number | string;
}

/** Matches the skeleton height so swapping one for the other cannot shift layout. */
export const STAT_CARD_HEIGHT = 96;

const SUMMARY_COLUMNS: TableColumn<SummaryRow>[] = [
  { title: 'Summary item', field: 'item' },
  { title: 'Total', field: 'total', type: 'numeric' },
  { title: 'Passed', field: 'passed', type: 'numeric' },
  { title: 'Failed', field: 'failed', type: 'numeric' },
  { title: 'Skipped', field: 'skipped' },
  { title: 'Error', field: 'error' },
];

const DENSE_TABLE_OPTIONS = { paging: false, search: false, padding: 'dense', toolbar: false } as const;

const useStyles = makeStyles(theme => ({
  card: {
    borderRadius: theme.shape.borderRadius * 2,
    padding: theme.spacing(1.5, 2),
    height: STAT_CARD_HEIGHT,
  },
  neutral: {
    borderColor: theme.palette.divider,
    backgroundColor: theme.palette.background.default,
  },
  error: {
    borderColor: theme.palette.error.light,
    backgroundColor: theme.palette.errorBackground,
  },
  label: {
    fontWeight: 600,
  },
  value: {
    marginTop: theme.spacing(1),
    fontWeight: 700,
  },
  successIcon: {
    color: theme.palette.success.main,
  },
  errorIcon: {
    color: theme.palette.error.main,
  },
}));

function StatCard(props: { label: string; value: number; variant: 'neutral' | 'error' }): JSX.Element {
  const classes = useStyles();
  const isError = props.variant === 'error';

  return (
    <Paper variant="outlined" className={`${classes.card} ${isError ? classes.error : classes.neutral}`}>
      <Box display="flex" alignItems="center" gridGap={8}>
        {isError ? (
          <CancelOutlinedIcon className={classes.errorIcon} />
        ) : (
          <CheckCircleOutlineIcon className={classes.successIcon} />
        )}
        <Typography variant="body2" color="textSecondary" className={classes.label}>
          {props.label}
        </Typography>
      </Box>
      <Typography variant="h4" className={classes.value}>
        {props.value}
      </Typography>
    </Paper>
  );
}

function BrunoReportSummaryViewComponent({ run }: BrunoReportSummaryViewProps): JSX.Element {
  const summary = run.summary;

  const tableRows = useMemo<SummaryRow[]>(
    () => [
      {
        item: 'Requests',
        total: summary.totalRequests,
        passed: summary.passedRequests,
        failed: summary.failedRequests,
        skipped: summary.skippedRequests,
        error: summary.errorRequests,
      },
      {
        item: 'Assertions',
        total: summary.totalAssertions,
        passed: summary.passedAssertions,
        failed: summary.failedAssertions,
        skipped: '—',
        error: '—',
      },
      {
        item: 'Tests',
        total: summary.totalTests,
        passed: summary.passedTests,
        failed: summary.failedTests,
        skipped: '—',
        error: '—',
      },
    ],
    [summary],
  );

  return (
    <InfoCard title="Run summary">
      <Box px={2} pb={2} pt={1}>
        <Grid container spacing={2} justifyContent="center">
          <Grid item xs={12} sm={6} md={3}>
            <StatCard label="Total requests" value={summary.totalRequests} variant="neutral" />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <StatCard label="Total errors" value={summary.errorRequests} variant="neutral" />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <StatCard label="Total controls" value={summary.totalAssertions + summary.totalTests} variant="neutral" />
          </Grid>
          <Grid item xs={12} sm={6} md={3}>
            <StatCard label="Failed controls" value={summary.failedAssertions + summary.failedTests} variant="error" />
          </Grid>
        </Grid>
      </Box>

      <Table options={DENSE_TABLE_OPTIONS} columns={SUMMARY_COLUMNS} data={tableRows} />
    </InfoCard>
  );
}

export const BrunoReportSummaryView = memo(BrunoReportSummaryViewComponent);
