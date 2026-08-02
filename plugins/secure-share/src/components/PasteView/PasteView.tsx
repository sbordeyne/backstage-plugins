import { CodeSnippet, CopyTextButton, InfoCard, MarkdownContent } from '@backstage/core-components';
import { formatByteSize } from '@sbordeyne/secure-share-common';
import { Button, Chip, Grid, Typography } from '@material-ui/core';
import Alert from '@material-ui/lab/Alert';
import { useEffect, useState } from 'react';
import { formatTimeRemaining } from '../../formatting';
import { PasteContent } from '../../hooks/usePasteContent';

interface PasteViewProps {
  content: PasteContent;
}

function DownloadButton({ content }: PasteViewProps): JSX.Element {
  const [objectUrl, setObjectUrl] = useState<string>();

  useEffect(() => {
    const url = URL.createObjectURL(content.payload);
    setObjectUrl(url);
    // Revoked on unmount so the decrypted bytes do not stay reachable from the page.
    return () => URL.revokeObjectURL(url);
  }, [content.payload]);

  return (
    <Button
      color="primary"
      variant="contained"
      href={objectUrl ?? ''}
      download={content.metadata.filename ?? 'download'}
      disabled={!objectUrl}
    >
      Download {content.metadata.filename ?? 'file'} ({formatByteSize(content.payload.size)})
    </Button>
  );
}

function TextContent({ content, text }: PasteViewProps & { text: string }): JSX.Element {
  if (content.metadata.markdown) {
    return <MarkdownContent content={text} />;
  }
  return <CodeSnippet text={text} language={content.metadata.language ?? 'plaintext'} showCopyCodeButton />;
}

function DecryptedPayload({ content, text }: PasteViewProps & { text?: string }): JSX.Element {
  if (content.summary.kind !== 'text') {
    return <DownloadButton content={content} />;
  }
  if (text === undefined) {
    return <Typography variant="body2">Decrypting…</Typography>;
  }
  return (
    <>
      <TextContent content={content} text={text} />
      <CopyTextButton text={text} tooltipText="Copied" />
    </>
  );
}

/**
 * Renders a paste that has already been decrypted in the browser.
 */
export function PasteView({ content }: PasteViewProps): JSX.Element {
  const [text, setText] = useState<string>();

  useEffect(() => {
    if (content.summary.kind === 'text') {
      content.payload.text().then(setText);
    }
  }, [content]);

  return (
    <InfoCard title={content.metadata.title}>
      <Grid container spacing={2}>
        <Grid item xs={12}>
          <Chip size="small" label={`from ${content.summary.createdByEntityRef}`} />
          <Chip size="small" label={formatTimeRemaining(content.summary.expiresAt)} />
          {content.summary.maxReads !== undefined ? (
            <Chip size="small" label={`read ${content.summary.readCount} of ${content.summary.maxReads} times`} />
          ) : null}
        </Grid>

        {content.summary.burnAfterRead ? (
          <Grid item xs={12}>
            <Alert severity="warning">
              This paste is destroyed after being read. Copy what you need now: reloading this page later will not work.
            </Alert>
          </Grid>
        ) : null}

        <Grid item xs={12}>
          <DecryptedPayload content={content} text={text} />
        </Grid>
      </Grid>
    </InfoCard>
  );
}
