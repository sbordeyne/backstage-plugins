import { renderInTestApp } from '@backstage/test-utils';
import type { BrunoReportResultResult, BrunoResultDetail } from '@sbordeyne/bruno-report-type';
import { screen } from '@testing-library/react';

import { BrunoReportResultView } from './BrunoReportResultView';

function entry(status: 'pass' | 'error' = 'pass'): BrunoReportResultResult {
  return { uid: 'u1', lhsExpr: 'res.status', rhsExpr: '200', rhsOperand: '200', operator: 'eq', status };
}

function makeDetail(overrides: Partial<BrunoResultDetail> = {}): BrunoResultDetail {
  return {
    id: 'result-1',
    runId: 'run-1',
    seq: 0,
    iterationIndex: 0,
    name: 'request',
    path: '/req/0',
    testFilename: 'req.bru',
    status: 'pass',
    requestMethod: 'POST',
    requestUrl: 'https://example.test/users',
    responseStatus: 200,
    responseStatusText: 'OK',
    responseTimeMs: 5,
    runDurationMs: 6,
    error: null,
    assertionsTotal: 0,
    assertionsPassed: 0,
    testsTotal: 0,
    testsPassed: 0,
    request: { headers: { 'content-type': 'application/json' }, data: null },
    response: { headers: { 'content-type': 'application/json' }, data: null, truncated: false },
    assertionResults: [],
    testResults: [],
    preRequestTestResults: [],
    postResponseTestResults: [],
    ...overrides,
  };
}

describe('BrunoReportResultView', () => {
  it('re-indents a JSON body that was stored compactly', async () => {
    // The worker stores JSON compactly to keep rows small, so it arrives as one
    // long line and has to be pretty-printed for display.
    const compact = '{"success":true,"data":{"role":"CLIENT","id":"abc"}}';
    await renderInTestApp(
      <BrunoReportResultView
        result={makeDetail({
          response: { headers: { 'content-type': 'application/json' }, data: compact, truncated: false },
        })}
      />,
    );

    const rendered = screen.getByText(/"success"/).closest('pre, code')?.textContent ?? '';
    expect(rendered.split('\n').length).toBeGreaterThan(1);
    expect(rendered).toContain('  "success": true');
  });

  it('leaves a non-JSON body exactly as it came back', async () => {
    await renderInTestApp(
      <BrunoReportResultView
        result={makeDetail({
          response: { headers: { 'content-type': 'text/plain' }, data: 'plain text, not json', truncated: false },
        })}
      />,
    );

    expect(screen.getByText(/plain text, not json/)).toBeInTheDocument();
  });

  it('leaves a malformed JSON body untouched rather than throwing', async () => {
    const broken = '{"success":true,';
    const { container } = await renderInTestApp(
      <BrunoReportResultView
        result={makeDetail({
          response: { headers: { 'content-type': 'application/json' }, data: broken, truncated: false },
        })}
      />,
    );

    // The highlighter splits the body across token elements, so match the
    // rendered text as a whole rather than a single node.
    const code = [...container.querySelectorAll('pre, code')].map(el => el.textContent ?? '').join('');
    expect(code).toContain(broken);
  });

  it('hides the assertion and test sections when there are none', async () => {
    await renderInTestApp(<BrunoReportResultView result={makeDetail()} />);

    expect(screen.queryByText('Assertions information')).not.toBeInTheDocument();
    expect(screen.queryByText('Tests information')).not.toBeInTheDocument();
  });

  it('shows only the sections that have rows', async () => {
    await renderInTestApp(<BrunoReportResultView result={makeDetail({ assertionResults: [entry()] })} />);

    expect(screen.getByText('Assertions information')).toBeInTheDocument();
    expect(screen.queryByText('Tests information')).not.toBeInTheDocument();
  });

  it('shows both sections when both have rows', async () => {
    await renderInTestApp(
      <BrunoReportResultView result={makeDetail({ assertionResults: [entry()], testResults: [entry('error')] })} />,
    );

    expect(screen.getByText('Assertions information')).toBeInTheDocument();
    expect(screen.getByText('Tests information')).toBeInTheDocument();
  });
});
