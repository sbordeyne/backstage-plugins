import { TestApiProvider, renderInTestApp } from '@backstage/test-utils';
import type { BrunoResultDetail, BrunoResultListItem } from '@sbordeyne/bruno-report-type';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { BrunoApi, brunoApiRef } from '../../api';
import { MockIntersectionObserver } from '../../testing/MockIntersectionObserver';
import { ResultsSection } from './ResultsSection';

function makeItem(seq: number): BrunoResultListItem {
  return {
    id: `result-${seq}`,
    runId: 'run-1',
    seq,
    iterationIndex: 0,
    name: `request ${seq}`,
    path: `/req/${seq}`,
    testFilename: `req-${seq}.bru`,
    status: seq % 2 === 0 ? 'pass' : 'error',
    requestMethod: 'GET',
    requestUrl: `https://example.test/${seq}`,
    responseStatus: 200,
    responseStatusText: 'OK',
    responseTimeMs: 3,
    runDurationMs: 4,
    error: null,
    assertionsTotal: 0,
    assertionsPassed: 0,
    testsTotal: 0,
    testsPassed: 0,
  };
}

function makeDetail(id: string): BrunoResultDetail {
  return {
    ...makeItem(0),
    id,
    request: { headers: {}, data: null },
    response: { headers: { 'content-type': 'application/json' }, data: { ok: true }, truncated: false },
    assertionResults: [],
    testResults: [],
    preRequestTestResults: [],
    postResponseTestResults: [],
  };
}

function renderSection(api: Partial<BrunoApi>, runId = 'run-1') {
  return renderInTestApp(
    <TestApiProvider apis={[[brunoApiRef, api as BrunoApi]]}>
      <ResultsSection runId={runId} expectedResultCount={5} />
    </TestApiProvider>,
  );
}

describe('ResultsSection', () => {
  it('renders a row per result without fetching any detail', async () => {
    const getResult = jest.fn();
    const api: Partial<BrunoApi> = {
      listResults: jest.fn().mockResolvedValue({ items: [makeItem(0), makeItem(1)], totalCount: 2 }),
      getResult,
    };

    await renderSection(api);

    await waitFor(() => expect(screen.getByText('/req/0')).toBeInTheDocument());
    expect(screen.getByText('/req/1')).toBeInTheDocument();
    // The whole point of the split: collapsed rows cost no detail request.
    expect(getResult).not.toHaveBeenCalled();
  });

  it('fetches detail once on first expand and not again on re-expand', async () => {
    const getResult = jest.fn().mockResolvedValue(makeDetail('result-0'));
    const api: Partial<BrunoApi> = {
      listResults: jest.fn().mockResolvedValue({ items: [makeItem(0)], totalCount: 1 }),
      getResult,
    };
    await renderSection(api);
    await waitFor(() => expect(screen.getByText('/req/0')).toBeInTheDocument());

    await userEvent.click(screen.getByText('/req/0'));
    await waitFor(() => expect(getResult).toHaveBeenCalledTimes(1));

    // Collapse, then expand again.
    await userEvent.click(screen.getByText('/req/0'));
    await userEvent.click(screen.getByText('/req/0'));

    expect(getResult).toHaveBeenCalledTimes(1);
    expect(getResult).toHaveBeenCalledWith({ resultId: 'result-0' });
  });

  it('shows an error inside the row when detail fails to load', async () => {
    const api: Partial<BrunoApi> = {
      listResults: jest.fn().mockResolvedValue({ items: [makeItem(0)], totalCount: 1 }),
      getResult: jest.fn().mockRejectedValue(new Error('detail unavailable')),
    };
    await renderSection(api);
    await waitFor(() => expect(screen.getByText('/req/0')).toBeInTheDocument());

    await userEvent.click(screen.getByText('/req/0'));

    await waitFor(() => expect(screen.getAllByText(/detail unavailable/).length).toBeGreaterThan(0));
  });

  it('appends the next page when Load more is clicked', async () => {
    const listResults = jest
      .fn()
      .mockResolvedValueOnce({ items: [makeItem(0)], nextCursor: '0', totalCount: 2 })
      .mockResolvedValueOnce({ items: [makeItem(1)], totalCount: 2 });
    await renderSection({ listResults, getResult: jest.fn() });
    await waitFor(() => expect(screen.getByText('/req/0')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /load more/i }));

    await waitFor(() => expect(screen.getByText('/req/1')).toBeInTheDocument());
    expect(listResults).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: '0' }));
  });

  it('appends the next page when the sentinel scrolls into view', async () => {
    const listResults = jest
      .fn()
      .mockResolvedValueOnce({ items: [makeItem(0)], nextCursor: '0', totalCount: 2 })
      .mockResolvedValueOnce({ items: [makeItem(1)], totalCount: 2 });
    await renderSection({ listResults, getResult: jest.fn() });
    await waitFor(() => expect(screen.getByText('/req/0')).toBeInTheDocument());

    await act(async () => {
      MockIntersectionObserver.latest().trigger();
    });

    await waitFor(() => expect(screen.getByText('/req/1')).toBeInTheDocument());
  });

  it('reports how much of the run is shown', async () => {
    const api: Partial<BrunoApi> = {
      listResults: jest.fn().mockResolvedValue({ items: [makeItem(0)], nextCursor: '0', totalCount: 42 }),
      getResult: jest.fn(),
    };

    await renderSection(api);

    await waitFor(() => expect(screen.getByText('Showing 1 of 42')).toBeInTheDocument());
  });

  it('refetches with a status filter when Failed only is selected', async () => {
    const listResults = jest.fn().mockResolvedValue({ items: [makeItem(1)], totalCount: 1 });
    await renderSection({ listResults, getResult: jest.fn() });
    await waitFor(() => expect(screen.getByText('/req/1')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /failed only/i }));

    await waitFor(() => expect(listResults).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' })));
  });

  it('keeps the full test path reachable when the row truncates it', async () => {
    // The path is ellipsized to stop long paths widening the page, so the
    // untruncated value has to stay available on hover.
    const longPath = 'users/User A update his fields/Generate a User A/Login as Admin';
    const item = { ...makeItem(0), path: longPath };
    const api: Partial<BrunoApi> = {
      listResults: jest.fn().mockResolvedValue({ items: [item], totalCount: 1 }),
      getResult: jest.fn(),
    };

    await renderSection(api);

    await waitFor(() => expect(screen.getByText(longPath)).toHaveAttribute('title', longPath));
  });

  it('shows an empty state for a run with no results', async () => {
    const api: Partial<BrunoApi> = {
      listResults: jest.fn().mockResolvedValue({ items: [], totalCount: 0 }),
      getResult: jest.fn(),
    };

    await renderSection(api);

    await waitFor(() => expect(screen.getByText('No test results')).toBeInTheDocument());
  });
});
