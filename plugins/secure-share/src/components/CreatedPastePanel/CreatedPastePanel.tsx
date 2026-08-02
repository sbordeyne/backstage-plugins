import { CopyTextButton, InfoCard, Link } from '@backstage/core-components';
import { Button, Grid, TextField, Typography } from '@material-ui/core';
import Alert from '@material-ui/lab/Alert';
import { CreatedPaste } from '../../hooks/useCreatePaste';

interface CreatedPastePanelProps {
  created: CreatedPaste;
  onCreateAnother: () => void;
}

/**
 * Shown once a paste has been uploaded.
 *
 * The secret link is displayed exactly once: its token is stored only as a digest, so
 * neither this page nor the backend can show it again.
 */
export function CreatedPastePanel({ created, onCreateAnother }: CreatedPastePanelProps): JSX.Element {
  const pastePath = `/secure-share/paste/${created.pasteId}`;

  return (
    <InfoCard title="Shared">
      <Grid container spacing={2}>
        <Grid item xs={12}>
          <Typography variant="body2">
            Recipients will find this in their &quot;Shared with me&quot; card. They can also open it directly:
          </Typography>
          <Link to={pastePath}>{pastePath}</Link>
        </Grid>

        {created.linkUrl ? (
          <>
            <Grid item xs={12}>
              <Alert severity="warning">
                This link is shown once and cannot be recovered. It contains the decryption key, so treat it as the
                secret itself.
              </Alert>
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                label="Secret link"
                value={created.linkUrl}
                InputProps={{ readOnly: true, endAdornment: <CopyTextButton text={created.linkUrl} /> }}
              />
            </Grid>
          </>
        ) : null}

        <Grid item xs={12}>
          <Button color="primary" onClick={onCreateAnother}>
            Share something else
          </Button>
        </Grid>
      </Grid>
    </InfoCard>
  );
}
