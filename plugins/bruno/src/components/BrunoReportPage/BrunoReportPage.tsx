import { Content, ContentHeader, InfoCard, Page, ResponseErrorPanel } from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { useEntity } from '@backstage/plugin-catalog-react';
import { stringifyEntityRef } from '@backstage/catalog-model';
import Grid from '@material-ui/core/Grid';
import Typography from '@material-ui/core/Typography';
import { useCallback, useMemo, useState } from 'react';

import { brunoApiRef } from '../../api';
import { useCursorList } from '../../hooks';
import { BrunoReportSummaryView } from '../BrunoReportSummaryView';
import { ResultsSection } from '../ResultsSection';
import { RunHistoryChart } from '../RunHistoryChart';
import { RunPicker } from '../RunPicker';
import { SummarySkeleton } from '../Skeletons';

/** Enough history for a readable chart without a second request. */
const RUN_HISTORY_SIZE = 30;

export function BrunoReportPage(): JSX.Element {
  const { entity } = useEntity();
  const api = useApi(brunoApiRef);
  const entityRef = useMemo(() => stringifyEntityRef(entity).toLowerCase(), [entity]);

  const [selectedRunId, setSelectedRunId] = useState<string>();

  const fetchRuns = useCallback(
    ({ cursor, limit, signal }: { cursor?: string; limit: number; signal: AbortSignal }) =>
      api.listRuns({ entityRef, limit, cursor, signal }),
    [api, entityRef],
  );

  // One request feeds the chart, the picker and the summary card.
  const runs = useCursorList(fetchRuns, { key: entityRef, limit: RUN_HISTORY_SIZE });

  const selectedRun = useMemo(
    () => runs.items.find(run => run.id === selectedRunId) ?? runs.items[0],
    [runs.items, selectedRunId],
  );

  const hasNoRuns = !runs.loading && !runs.error && runs.items.length === 0;

  return (
    <Page themeId="tool">
      <Content>
        {/* Painted on the first frame: nothing below gates the layout. */}
        <ContentHeader title="Bruno test reports" />

        {/* wrap="nowrap" is load-bearing: a *wrapping* column flex container sizes
            its line to the items' max-content width and stretches them to that,
            not to the container, so the cards would grow past the page. */}
        <Grid container spacing={3} direction="column" wrap="nowrap">
          <Grid item>
            <InfoCard title="Run history">
              {runs.error && <ResponseErrorPanel error={runs.error} />}
              {hasNoRuns && (
                <Typography variant="body2" color="textSecondary">
                  No runs have been synced yet. The worker imports reports from storage on a schedule; this page will
                  fill in after the next run.
                </Typography>
              )}
              {!hasNoRuns && !runs.error && (
                <RunHistoryChart runs={runs.items} selectedRunId={selectedRun?.id} onSelectRun={setSelectedRunId} />
              )}
            </InfoCard>
          </Grid>

          <Grid item>
            <RunPicker
              runs={runs.items}
              selectedRunId={selectedRun?.id}
              loading={runs.initialLoading}
              onSelectRun={setSelectedRunId}
            />
          </Grid>

          <Grid item>
            {selectedRun ? (
              <BrunoReportSummaryView run={selectedRun} />
            ) : (
              <InfoCard title="Run summary">
                <SummarySkeleton />
              </InfoCard>
            )}
          </Grid>

          <Grid item>
            <ResultsSection runId={selectedRun?.id} expectedResultCount={selectedRun?.resultsCount} />
          </Grid>
        </Grid>
      </Content>
    </Page>
  );
}
