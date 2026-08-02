import { InfoCard, StructuredMetadataTable, Table, TableColumn } from '@backstage/core-components';
import Box from '@material-ui/core/Box';
import Grid from '@material-ui/core/Grid';
import { makeStyles } from '@material-ui/core/styles';
import type { BrunoResultDetail } from '@sbordeyne/bruno-report-type';
import { memo, useMemo } from 'react';

import { BodyLanguage, BodyViewer } from '../BodyViewer';
import { StatusChip } from '../StatusChip';

export interface BrunoReportResultViewProps {
  result: BrunoResultDetail;
}

interface AssertionRow {
  expression: string;
  operator: string;
  operand: string;
  status: 'pass' | 'error';
  error: string;
}

interface TestRow {
  description: string;
  status: 'pass' | 'error';
  error: string;
}

// Hoisted to module scope: rebuilding these per render makes material-table
// re-derive its internal state on every parent update.
const DENSE_TABLE_OPTIONS = { paging: false, search: false, padding: 'dense', toolbar: false } as const;
const NO_DATA_LOCALIZATION = { body: { emptyDataSourceMessage: 'No Data' } } as const;

const ASSERTION_COLUMNS: TableColumn<AssertionRow>[] = [
  { title: 'Expression', field: 'expression' },
  { title: 'Operator', field: 'operator' },
  { title: 'Operand', field: 'operand' },
  { title: 'Status', field: 'status', render: row => <StatusChip status={row.status} /> },
  { title: 'Error', field: 'error' },
];

const TEST_COLUMNS: TableColumn<TestRow>[] = [
  { title: 'Description', field: 'description' },
  { title: 'Status', field: 'status', render: row => <StatusChip status={row.status} /> },
  { title: 'Error', field: 'error' },
];

function formatMs(ms?: number | null): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) {
    return '—';
  }
  return `${Math.round(ms)} ms`;
}

/** Above this, re-indenting costs more than the readability is worth. */
const PRETTY_PRINT_MAX_CHARS = 512 * 1024;

/**
 * Bodies are stored as text, and the worker serializes JSON compactly to keep
 * rows small — so a JSON body arrives here as one long line and has to be
 * re-indented for display.
 */
function formatBody(data: unknown): string {
  if (data === null || data === undefined) {
    return '';
  }

  if (typeof data === 'string') {
    const trimmed = data.trim();
    const looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[');
    if (!looksLikeJson || trimmed.length > PRETTY_PRINT_MAX_CHARS) {
      return data;
    }
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      // Not actually JSON — show it exactly as it came back.
      return data;
    }
  }

  try {
    return JSON.stringify(data, null, 2);
  } catch {
    // Circular structures and the like.
    return String(data);
  }
}

function detectCodeLanguage(contentType?: string): BodyLanguage {
  if (!contentType) {
    return 'text';
  }
  const type = contentType.toLowerCase();
  if (type.includes('application/json')) {
    return 'json';
  }
  if (type.includes('application/yaml') || type.includes('application/x-yaml')) {
    return 'yaml';
  }
  if (type.includes('application/xml') || type.includes('text/xml')) {
    return 'xml';
  }
  if (type.includes('text/html')) {
    return 'html';
  }
  return 'text';
}

function getHeader(headers: Record<string, string>, name: string): string | undefined {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1];
}

function headersToMetadata(headers: Record<string, string>): Record<string, string> {
  return Object.keys(headers).length > 0 ? headers : { Headers: '—' };
}

const useStyles = makeStyles({
  root: {
    minWidth: 0,
  },
  // Request URLs and header values are long, unbroken strings. Without an
  // explicit break they set the table's min-content width and push the page
  // into a horizontal scroll.
  wrapping: {
    minWidth: 0,
    '& td, & th': {
      wordBreak: 'break-word',
      overflowWrap: 'anywhere',
    },
  },
  scrollable: {
    minWidth: 0,
    overflowX: 'auto',
  },
  // The Grid row already stretches both items to the taller one; the card inside
  // has to fill that height for the two panels to line up.
  fullHeight: {
    height: '100%',
  },
});

function BrunoReportResultViewComponent({ result }: BrunoReportResultViewProps): JSX.Element {
  const classes = useStyles();
  const requestHeaders = result.request.headers;
  const responseHeaders = result.response.headers;

  const responseBody = useMemo(() => formatBody(result.response.data), [result.response.data]);
  const requestBody = useMemo(() => formatBody(result.request.data), [result.request.data]);

  const requestLanguage = useMemo(
    () => detectCodeLanguage(getHeader(requestHeaders, 'content-type') ?? getHeader(requestHeaders, 'accept')),
    [requestHeaders],
  );
  const responseLanguage = useMemo(
    () => detectCodeLanguage(getHeader(responseHeaders, 'content-type')),
    [responseHeaders],
  );

  const assertionRows = useMemo<AssertionRow[]>(
    () =>
      result.assertionResults.map(entry => ({
        expression: entry.lhsExpr,
        operator: entry.operator,
        operand: entry.rhsOperand,
        status: entry.status,
        error: entry.status === 'error' ? entry.rhsExpr : '',
      })),
    [result.assertionResults],
  );

  const testRows = useMemo<TestRow[]>(
    () =>
      result.testResults.map(entry => ({
        description: entry.rhsExpr || entry.lhsExpr,
        status: entry.status,
        error: entry.status === 'error' ? entry.rhsExpr : '',
      })),
    [result.testResults],
  );

  return (
    <Box display="flex" flexDirection="column" gridGap={24} width="100%" className={classes.root}>
      <Grid container spacing={3}>
        <Grid item xs={12} md={7}>
          <InfoCard title="Request information" className={`${classes.wrapping} ${classes.fullHeight}`}>
            <StructuredMetadataTable
              metadata={{
                File: result.testFilename ?? '—',
                'Request Method': result.requestMethod ?? '—',
                'Request URL': result.requestUrl ?? '—',
              }}
            />
          </InfoCard>
        </Grid>

        <Grid item xs={12} md={5}>
          <InfoCard title="Response information" className={classes.fullHeight}>
            <StructuredMetadataTable
              metadata={{
                'Response Code': String(result.responseStatus ?? '—'),
                'Response time': formatMs(result.responseTimeMs),
                'Test duration': formatMs(result.runDurationMs),
              }}
            />
          </InfoCard>
        </Grid>
      </Grid>

      {/* Key/value lists: StructuredMetadataTable rather than material-table,
          which halves the heavyweight table instances per expanded row. */}
      <InfoCard title="Request headers" className={classes.wrapping}>
        <StructuredMetadataTable metadata={headersToMetadata(requestHeaders)} />
      </InfoCard>

      <InfoCard title="Request body">
        {requestBody ? (
          <BodyViewer text={requestBody} language={requestLanguage} />
        ) : (
          <StructuredMetadataTable metadata={{ Body: '—' }} />
        )}
      </InfoCard>

      <InfoCard title="Response headers" className={classes.wrapping}>
        <StructuredMetadataTable metadata={headersToMetadata(responseHeaders)} />
      </InfoCard>

      <InfoCard title="Response body">
        {responseBody ? (
          <BodyViewer text={responseBody} language={responseLanguage} truncatedByBackend={result.response.truncated} />
        ) : (
          <StructuredMetadataTable metadata={{ Body: '—' }} />
        )}
      </InfoCard>

      {assertionRows.length > 0 && (
        <InfoCard title="Assertions information" className={classes.scrollable}>
          <Table
            options={DENSE_TABLE_OPTIONS}
            localization={NO_DATA_LOCALIZATION}
            columns={ASSERTION_COLUMNS}
            data={assertionRows}
          />
        </InfoCard>
      )}

      {testRows.length > 0 && (
        <InfoCard title="Tests information" className={classes.scrollable}>
          <Table
            options={DENSE_TABLE_OPTIONS}
            localization={NO_DATA_LOCALIZATION}
            columns={TEST_COLUMNS}
            data={testRows}
          />
        </InfoCard>
      )}
    </Box>
  );
}

export const BrunoReportResultView = memo(BrunoReportResultViewComponent);
