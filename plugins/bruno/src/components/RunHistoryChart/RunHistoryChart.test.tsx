import { renderInTestApp } from '@backstage/test-utils';
import type { BrunoReportSummary, BrunoRunSummary } from '@sbordeyne/bruno-report-type';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { RunHistoryChart } from './RunHistoryChart';
import { getChartPalette } from './chartPalette';

function makeRun(
  id: string,
  options: { passed: number; failed: number; skipped: number; at: string },
): BrunoRunSummary {
  const summary: BrunoReportSummary = {
    totalRequests: options.passed + options.failed + options.skipped,
    passedRequests: options.passed,
    failedRequests: options.failed,
    errorRequests: 0,
    skippedRequests: options.skipped,
    totalAssertions: 0,
    passedAssertions: 0,
    failedAssertions: 0,
    totalTests: 0,
    passedTests: 0,
    failedTests: 0,
    totalPreRequestTests: 0,
    passedPreRequestTests: 0,
    failedPreRequestTests: 0,
    totalPostResponseTests: 0,
    passedPostResponseTests: 0,
    failedPostResponseTests: 0,
  };
  return {
    id,
    entityRef: 'component:default/sample',
    reportName: 'sample.json',
    artifactCreatedAt: options.at,
    syncedAt: options.at,
    iterationCount: 1,
    status: options.failed > 0 ? 'fail' : 'pass',
    gcsObject: `ui_tests/reports/bruno/${id}/unit/sample.json`,
    resultsCount: summary.totalRequests,
    summary,
  };
}

const runs = [
  makeRun('newest', { passed: 8, failed: 2, skipped: 1, at: '2026-07-03T10:00:00.000Z' }),
  makeRun('middle', { passed: 10, failed: 0, skipped: 0, at: '2026-07-02T10:00:00.000Z' }),
  makeRun('oldest', { passed: 5, failed: 5, skipped: 0, at: '2026-07-01T10:00:00.000Z' }),
];

describe('RunHistoryChart', () => {
  it('renders one labelled bar per run', async () => {
    await renderInTestApp(<RunHistoryChart runs={runs} onSelectRun={jest.fn()} />);

    expect(screen.getByLabelText(/Request outcomes across the last 3 runs/)).toBeInTheDocument();
    // Each bar restates its numbers for screen readers.
    expect(screen.getByLabelText(/8 passed, 2 failed, 1 skipped/)).toBeInTheDocument();
    expect(screen.getByLabelText(/5 passed, 5 failed, 0 skipped/)).toBeInTheDocument();
  });

  it('always renders a labelled legend', async () => {
    await renderInTestApp(<RunHistoryChart runs={runs} onSelectRun={jest.fn()} />);

    const legend = within(screen.getByLabelText('Run history legend'));
    expect(legend.getByText('Passed')).toBeInTheDocument();
    expect(legend.getByText('Failed')).toBeInTheDocument();
    expect(legend.getByText('Skipped')).toBeInTheDocument();
  });

  it('selects a run when its bar is clicked', async () => {
    const onSelectRun = jest.fn();
    await renderInTestApp(<RunHistoryChart runs={runs} onSelectRun={onSelectRun} />);

    await userEvent.click(screen.getByLabelText(/8 passed, 2 failed, 1 skipped/));

    expect(onSelectRun).toHaveBeenCalledWith('newest');
  });

  it('selects a run from the keyboard', async () => {
    const onSelectRun = jest.fn();
    await renderInTestApp(<RunHistoryChart runs={runs} onSelectRun={onSelectRun} />);

    screen.getByLabelText(/5 passed, 5 failed, 0 skipped/).focus();
    await userEvent.keyboard('{Enter}');

    expect(onSelectRun).toHaveBeenCalledWith('oldest');
  });

  it('renders without bars when there is no history', async () => {
    await renderInTestApp(<RunHistoryChart runs={[]} onSelectRun={jest.fn()} />);

    expect(screen.getByLabelText(/Request outcomes across the last 0 runs/)).toBeInTheDocument();
  });

  it('uses validated, distinct palettes in both themes', () => {
    const light = getChartPalette(false);
    const dark = getChartPalette(true);

    for (const palette of [light, dark]) {
      expect(new Set([palette.passed, palette.failed, palette.skipped]).size).toBe(3);
    }
    // The dark theme's own paper colour cannot carry chart marks, so the chart
    // paints its own darker surface.
    expect(dark.surface).not.toBe('#767470');
  });
});
