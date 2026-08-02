import { TestApiProvider, renderInTestApp } from '@backstage/test-utils';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import type { Entity } from '@backstage/catalog-model';
import type { BrunoReportSummary, BrunoRunSummary } from '@sbordeyne/bruno-report-type';
import { screen, waitFor, within } from '@testing-library/react';

import { BrunoApi, brunoApiRef } from '../../api';
import { BrunoReportPage } from './BrunoReportPage';

const entity: Entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: { name: 'sample', namespace: 'default', annotations: { 'usebruno.com/report-path': 'sample.json' } },
};

const summary: BrunoReportSummary = {
  totalRequests: 10,
  passedRequests: 8,
  failedRequests: 1,
  errorRequests: 1,
  skippedRequests: 0,
  totalAssertions: 4,
  passedAssertions: 4,
  failedAssertions: 0,
  totalTests: 2,
  passedTests: 2,
  failedTests: 0,
  totalPreRequestTests: 0,
  passedPreRequestTests: 0,
  failedPreRequestTests: 0,
  totalPostResponseTests: 0,
  passedPostResponseTests: 0,
  failedPostResponseTests: 0,
};

function makeRun(id: string): BrunoRunSummary {
  return {
    id,
    entityRef: 'component:default/sample',
    reportName: 'sample.json',
    artifactCreatedAt: '2026-07-01T10:00:00.000Z',
    syncedAt: '2026-07-01T10:05:00.000Z',
    iterationCount: 1,
    status: 'pass',
    artifactPath: `ui_tests/reports/bruno/${id}/unit/sample.json`,
    resultsCount: 10,
    summary,
  };
}

function renderPage(api: Partial<BrunoApi>) {
  return renderInTestApp(
    <TestApiProvider apis={[[brunoApiRef, api as BrunoApi]]}>
      <EntityProvider entity={entity}>
        <BrunoReportPage />
      </EntityProvider>
    </TestApiProvider>,
  );
}

describe('BrunoReportPage', () => {
  it('paints the layout before any data arrives', async () => {
    // Deliberately never resolves: the frame must not depend on the response.
    const api: Partial<BrunoApi> = {
      listRuns: () => new Promise(() => {}),
      listResults: () => new Promise(() => {}),
    };

    await renderPage(api);

    expect(screen.getByText('Bruno test reports')).toBeInTheDocument();
    expect(screen.getByText('Run history')).toBeInTheDocument();
    expect(screen.getByText('Run summary')).toBeInTheDocument();
    expect(screen.getByText('Test results')).toBeInTheDocument();
  });

  it('renders the chart and summary once runs load', async () => {
    const api: Partial<BrunoApi> = {
      listRuns: jest.fn().mockResolvedValue({ items: [makeRun('run-1')] }),
      listResults: jest.fn().mockResolvedValue({ items: [], totalCount: 0 }),
    };

    await renderPage(api);

    await waitFor(() => expect(screen.getByLabelText(/Request outcomes across the last 1 runs/)).toBeInTheDocument());
    // The legend names every series, so identity never rests on colour alone.
    const legend = within(screen.getByLabelText('Run history legend'));
    expect(legend.getByText('Passed')).toBeInTheDocument();
    expect(legend.getByText('Failed')).toBeInTheDocument();
    expect(legend.getByText('Skipped')).toBeInTheDocument();
  });

  it('shows an empty state when nothing has been synced yet', async () => {
    const api: Partial<BrunoApi> = {
      listRuns: jest.fn().mockResolvedValue({ items: [] }),
      listResults: jest.fn().mockResolvedValue({ items: [], totalCount: 0 }),
    };

    await renderPage(api);

    await waitFor(() => expect(screen.getByText(/No runs have been synced yet/)).toBeInTheDocument());
  });

  it('surfaces a failure to load runs', async () => {
    const api: Partial<BrunoApi> = {
      listRuns: jest.fn().mockRejectedValue(new Error('backend exploded')),
      listResults: jest.fn().mockResolvedValue({ items: [], totalCount: 0 }),
    };

    await renderPage(api);

    // ResponseErrorPanel repeats the message in its title and its body.
    await waitFor(() => expect(screen.getAllByText(/backend exploded/).length).toBeGreaterThan(0));
  });

  it('requests results for the newest run', async () => {
    const listResults = jest.fn().mockResolvedValue({ items: [], totalCount: 0 });
    const api: Partial<BrunoApi> = {
      listRuns: jest.fn().mockResolvedValue({ items: [makeRun('newest'), makeRun('older')] }),
      listResults,
    };

    await renderPage(api);

    await waitFor(() => expect(listResults).toHaveBeenCalledWith(expect.objectContaining({ runId: 'newest' })));
  });
});
