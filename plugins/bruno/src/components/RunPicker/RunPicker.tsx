import MenuItem from '@material-ui/core/MenuItem';
import TextField from '@material-ui/core/TextField';
import Skeleton from '@material-ui/lab/Skeleton';
import type { BrunoRunSummary } from '@sbordeyne/bruno-report-type';
import { memo } from 'react';

export interface RunPickerProps {
  runs: BrunoRunSummary[];
  selectedRunId?: string;
  loading: boolean;
  onSelectRun: (runId: string) => void;
}

function describeRun(run: BrunoRunSummary): string {
  const when = new Date(run.artifactCreatedAt).toLocaleString();
  const failed = run.summary.failedRequests + run.summary.errorRequests;
  const outcome = failed > 0 ? `${failed} failed` : 'all passed';
  return `${when} — ${run.summary.totalRequests} requests, ${outcome}`;
}

/**
 * Doubles as the chart's accessible alternative: the same runs and outcomes as
 * text, navigable by keyboard.
 */
function RunPickerComponent({ runs, selectedRunId, loading, onSelectRun }: RunPickerProps): JSX.Element {
  if (loading && runs.length === 0) {
    return <Skeleton variant="rect" height={56} animation="wave" />;
  }

  return (
    <TextField
      select
      fullWidth
      variant="outlined"
      size="small"
      label="Run"
      value={selectedRunId ?? ''}
      onChange={event => onSelectRun(event.target.value)}
      disabled={runs.length === 0}
      inputProps={{ 'aria-label': 'Select a Bruno run' }}
    >
      {runs.map(run => (
        <MenuItem key={run.id} value={run.id}>
          {describeRun(run)}
        </MenuItem>
      ))}
    </TextField>
  );
}

export const RunPicker = memo(RunPickerComponent);
