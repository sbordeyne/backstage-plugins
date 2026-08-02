import Box from '@material-ui/core/Box';
import Tooltip from '@material-ui/core/Tooltip';
import Typography from '@material-ui/core/Typography';
import { makeStyles, useTheme } from '@material-ui/core/styles';
import type { BrunoRunSummary } from '@sbordeyne/bruno-report-type';
import { memo, useMemo } from 'react';

import { ChartPalette, getChartPalette } from './chartPalette';

export interface RunHistoryChartProps {
  runs: BrunoRunSummary[];
  selectedRunId?: string;
  onSelectRun: (runId: string) => void;
}

const PLOT_HEIGHT = 160;
const BAR_WIDTH = 22;
const BAR_GAP = 10;
const CORNER_RADIUS = 4;
/** Surface-coloured gap between stacked segments, per the mark spec. */
const SEGMENT_GAP = 2;
const AXIS_LABEL_HEIGHT = 22;

interface Series {
  key: 'passed' | 'failed' | 'skipped';
  label: string;
  color: (palette: ChartPalette) => string;
}

const SERIES: Series[] = [
  { key: 'passed', label: 'Passed', color: palette => palette.passed },
  { key: 'failed', label: 'Failed', color: palette => palette.failed },
  { key: 'skipped', label: 'Skipped', color: palette => palette.skipped },
];

interface Column {
  run: BrunoRunSummary;
  passed: number;
  failed: number;
  skipped: number;
  total: number;
}

const useStyles = makeStyles(theme => ({
  scroller: {
    overflowX: 'auto',
    overflowY: 'hidden',
    // The SVG is sized to the run count, so it is routinely wider than the card.
    // These keep that width inside its own scroll container instead of letting it
    // stretch the page.
    minWidth: 0,
    maxWidth: '100%',
    padding: theme.spacing(2),
    borderRadius: theme.shape.borderRadius * 2,
  },
  column: {
    cursor: 'pointer',
  },
  failedSegment: {
    // Keeps the red/green pair distinguishable when colours are overridden.
    '@media (forced-colors: active)': {
      fill: 'url(#bruno-run-history-hatch)',
    },
  },
  legend: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: theme.spacing(2),
    padding: theme.spacing(0, 2, 1),
  },
  legendEntry: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(0.75),
  },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: 2,
    display: 'inline-block',
  },
}));

function toColumn(run: BrunoRunSummary): Column {
  const summary = run.summary;
  // Bruno only tracks "skipped" for requests, so the bars count requests.
  const failed = summary.failedRequests + summary.errorRequests;
  const passed = summary.passedRequests;
  const skipped = summary.skippedRequests;
  return { run, passed, failed, skipped, total: passed + failed + skipped };
}

/** Rect anchored to the baseline, optionally rounded on its top corners. */
function segmentPath(x: number, y: number, width: number, height: number, roundedTop: boolean): string {
  if (height <= 0) {
    return '';
  }
  const radius = roundedTop ? Math.min(CORNER_RADIUS, height, width / 2) : 0;
  if (radius === 0) {
    return `M ${x} ${y} h ${width} v ${height} h ${-width} Z`;
  }
  return [
    `M ${x} ${y + radius}`,
    `a ${radius} ${radius} 0 0 1 ${radius} ${-radius}`,
    `h ${width - 2 * radius}`,
    `a ${radius} ${radius} 0 0 1 ${radius} ${radius}`,
    `v ${height - radius}`,
    `h ${-width}`,
    'Z',
  ].join(' ');
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ColumnTooltip(props: { column: Column }): JSX.Element {
  const { column } = props;
  const passRate = column.total > 0 ? Math.round((column.passed / column.total) * 100) : 0;
  return (
    <div>
      <Typography variant="subtitle2">{formatTimestamp(column.run.artifactCreatedAt)}</Typography>
      <Typography variant="body2">Passed: {column.passed}</Typography>
      <Typography variant="body2">Failed: {column.failed}</Typography>
      <Typography variant="body2">Skipped: {column.skipped}</Typography>
      <Typography variant="body2">
        Total: {column.total} ({passRate}% passed)
      </Typography>
    </div>
  );
}

function RunHistoryChartComponent({ runs, selectedRunId, onSelectRun }: RunHistoryChartProps): JSX.Element {
  const classes = useStyles();
  const theme = useTheme();
  // v4 spells the mode `palette.type`; v5+ renamed it to `palette.mode`.
  const palette = getChartPalette(theme.palette.type === 'dark');

  // The API returns newest first; a history chart reads oldest to newest.
  const columns = useMemo(() => runs.map(toColumn).reverse(), [runs]);
  const maxTotal = useMemo(() => Math.max(1, ...columns.map(column => column.total)), [columns]);

  const chartWidth = Math.max(columns.length * (BAR_WIDTH + BAR_GAP), BAR_WIDTH + BAR_GAP);
  const chartHeight = PLOT_HEIGHT + AXIS_LABEL_HEIGHT;

  return (
    <Box>
      <Box className={classes.scroller} style={{ backgroundColor: palette.surface }}>
        <svg
          width={chartWidth}
          height={chartHeight}
          role="group"
          aria-label={`Request outcomes across the last ${columns.length} runs`}
        >
          <defs>
            <pattern id="bruno-run-history-hatch" width="6" height="6" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="transparent" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="3" />
            </pattern>
          </defs>

          {columns.map((column, index) => {
            const x = index * (BAR_WIDTH + BAR_GAP);
            const isSelected = column.run.id === selectedRunId;
            const scale = PLOT_HEIGHT / maxTotal;

            const heights = {
              passed: column.passed * scale,
              failed: column.failed * scale,
              skipped: column.skipped * scale,
            };
            const topSeries = [...SERIES].reverse().find(series => heights[series.key] > 0)?.key;

            let cursorY = PLOT_HEIGHT;
            const segments = SERIES.map(series => {
              const rawHeight = heights[series.key];
              if (rawHeight <= 0) {
                return null;
              }
              const height = Math.max(rawHeight - SEGMENT_GAP, 1);
              cursorY -= rawHeight;
              return {
                key: series.key,
                d: segmentPath(x, cursorY, BAR_WIDTH, height, series.key === topSeries),
                fill: series.color(palette),
              };
            }).filter((segment): segment is NonNullable<typeof segment> => segment !== null);

            return (
              <Tooltip key={column.run.id} title={<ColumnTooltip column={column} />} placement="top">
                <g
                  className={classes.column}
                  role="img"
                  aria-label={`${formatTimestamp(column.run.artifactCreatedAt)}: ${column.passed} passed, ${
                    column.failed
                  } failed, ${column.skipped} skipped`}
                  tabIndex={0}
                  onClick={() => onSelectRun(column.run.id)}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectRun(column.run.id);
                    }
                  }}
                >
                  {/* Hit target spans the full column, not just the drawn bar. */}
                  <rect x={x} y={0} width={BAR_WIDTH} height={PLOT_HEIGHT} fill="transparent" />
                  {segments.map(segment => (
                    <path
                      key={segment.key}
                      d={segment.d}
                      fill={segment.fill}
                      className={segment.key === 'failed' ? classes.failedSegment : undefined}
                    />
                  ))}
                  {isSelected && (
                    <rect
                      x={x - 2}
                      y={0}
                      width={BAR_WIDTH + 4}
                      height={PLOT_HEIGHT + 4}
                      fill="none"
                      stroke={palette.label}
                      strokeWidth={2}
                      rx={CORNER_RADIUS}
                    />
                  )}
                </g>
              </Tooltip>
            );
          })}

          {/* Recessive baseline; no gridlines. */}
          <line x1={0} y1={PLOT_HEIGHT} x2={chartWidth} y2={PLOT_HEIGHT} stroke={palette.axis} strokeWidth={1} />
          <text x={0} y={PLOT_HEIGHT + 16} fill={palette.label} fontSize={11}>
            oldest
          </text>
          <text x={chartWidth} y={PLOT_HEIGHT + 16} fill={palette.label} fontSize={11} textAnchor="end">
            newest · max {maxTotal} requests
          </text>
        </svg>
      </Box>

      {/* Three series always get a legend, and each entry is labelled — identity
          is never carried by colour alone. */}
      <div className={classes.legend} aria-label="Run history legend">
        {SERIES.map(series => (
          <span key={series.key} className={classes.legendEntry}>
            <span className={classes.swatch} style={{ backgroundColor: series.color(palette) }} aria-hidden />
            <Typography variant="caption">{series.label}</Typography>
          </span>
        ))}
      </div>
    </Box>
  );
}

export const RunHistoryChart = memo(RunHistoryChartComponent);
