import { CodeSnippet, CopyTextButton, WarningPanel } from '@backstage/core-components';
import Box from '@material-ui/core/Box';
import Button from '@material-ui/core/Button';
import Typography from '@material-ui/core/Typography';
import { makeStyles } from '@material-ui/core/styles';
import { memo, useMemo, useState } from 'react';

/**
 * react-syntax-highlighter builds one React element per token, so highlighting a
 * large body locks the main thread. These thresholds keep it off the critical
 * path and make the cost opt-in.
 */
const HIGHLIGHT_MAX_CHARS = 64 * 1024;
const PLAIN_MAX_CHARS = 1024 * 1024;
const LINE_NUMBER_MAX_LINES = 500;
const TRUNCATED_PREVIEW_CHARS = 64 * 1024;

export type BodyLanguage = 'json' | 'yaml' | 'xml' | 'html' | 'text';

export interface BodyViewerProps {
  text: string;
  language: BodyLanguage;
  /** Set when the backend already truncated the body at ingest time. */
  truncatedByBackend?: boolean;
}

const useStyles = makeStyles(theme => ({
  pre: {
    maxHeight: 400,
    overflow: 'auto',
    margin: 0,
    padding: theme.spacing(1),
    fontFamily: 'monospace',
    fontSize: theme.typography.pxToRem(12),
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    backgroundColor: theme.palette.background.default,
    borderRadius: theme.shape.borderRadius,
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: theme.spacing(1),
    marginTop: theme.spacing(1),
  },
}));

function formatSize(chars: number): string {
  if (chars < 1024) {
    return `${chars} B`;
  }
  if (chars < 1024 * 1024) {
    return `${Math.round(chars / 1024)} KiB`;
  }
  return `${(chars / (1024 * 1024)).toFixed(1)} MiB`;
}

function BodyViewerComponent({ text, language, truncatedByBackend }: BodyViewerProps): JSX.Element {
  const classes = useStyles();
  const [forceHighlight, setForceHighlight] = useState(false);

  const size = text.length;
  const lineCount = useMemo(() => (size <= HIGHLIGHT_MAX_CHARS ? text.split('\n').length : Infinity), [text, size]);

  if (size <= HIGHLIGHT_MAX_CHARS || forceHighlight) {
    return (
      <>
        {truncatedByBackend && (
          <WarningPanel severity="info" title="Body was truncated when the run was synced" defaultExpanded={false} />
        )}
        <CodeSnippet
          language={language}
          text={text}
          showLineNumbers={lineCount <= LINE_NUMBER_MAX_LINES}
          showCopyCodeButton
          wrapLongLines
        />
      </>
    );
  }

  const isHuge = size > PLAIN_MAX_CHARS;
  const shown = isHuge ? text.slice(0, TRUNCATED_PREVIEW_CHARS) : text;

  return (
    <Box>
      {isHuge && (
        <WarningPanel
          severity="info"
          title={`Body truncated — showing ${formatSize(TRUNCATED_PREVIEW_CHARS)} of ${formatSize(size)}`}
        />
      )}
      <pre className={classes.pre}>{shown}</pre>
      <div className={classes.toolbar}>
        <CopyTextButton text={text} tooltipText="Body copied" />
        {!isHuge && (
          <Button size="small" variant="outlined" onClick={() => setForceHighlight(true)}>
            Highlight anyway ({formatSize(size)})
          </Button>
        )}
        <Typography variant="caption" color="textSecondary">
          Syntax highlighting is off for bodies over {formatSize(HIGHLIGHT_MAX_CHARS)}.
        </Typography>
      </div>
    </Box>
  );
}

export const BodyViewer = memo(BodyViewerComponent);
