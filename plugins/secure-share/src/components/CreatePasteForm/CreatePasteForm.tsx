import { InfoCard } from '@backstage/core-components';
import { errorApiRef, useApi } from '@backstage/core-plugin-api';
import { formatByteSize } from '@sbordeyne/secure-share-common';
import { Button, Checkbox, FormControlLabel, Grid, MenuItem, TextField, Typography } from '@material-ui/core';
import Alert from '@material-ui/lab/Alert';
import { ChangeEvent, useState } from 'react';
import { formatDuration } from '../../formatting';
import { useCreatePaste } from '../../hooks/useCreatePaste';
import { useKeyPins } from '../../hooks/useKeyPins';
import { useResolvedRecipients } from '../../hooks/useResolvedRecipients';
import { useSecureShareConfig } from '../../hooks/useSecureShareConfig';
import { CreatedPastePanel } from '../CreatedPastePanel';
import { RecipientPicker } from '../RecipientPicker';
import { RecipientSummary } from '../RecipientSummary';
import { CreatedPaste } from '../../hooks/useCreatePaste';

const LANGUAGES = ['plaintext', 'json', 'yaml', 'sql', 'shell', 'typescript', 'python', 'markdown'];

interface FormState {
  kind: 'text' | 'file';
  title: string;
  text: string;
  language: string;
  file?: File;
  recipientEntityRefs: string[];
  expiresInMs: number;
  burnAfterRead: boolean;
  linkEnabled: boolean;
  maxReads: string;
}

/**
 * Form that encrypts a paste in the browser and uploads the ciphertext.
 *
 * Limits shown here come from the same config reader the backend uses, so what the form
 * accepts is what the backend will accept.
 */
export function CreatePasteForm(): JSX.Element {
  const config = useSecureShareConfig();
  const errorApi = useApi(errorApiRef);
  const { create, busy, uploadedChunks, totalChunks } = useCreatePaste();
  const [form, setForm] = useState<FormState>({
    kind: 'text',
    title: '',
    text: '',
    language: 'plaintext',
    recipientEntityRefs: [],
    expiresInMs: config.expiration.defaultMs,
    burnAfterRead: true,
    linkEnabled: false,
    maxReads: '',
  });
  const [created, setCreated] = useState<CreatedPaste>();
  const resolution = useResolvedRecipients(form.recipientEntityRefs);
  const pins = useKeyPins(resolution.value.recipients);

  const payload = form.kind === 'file' ? form.file : new Blob([form.text]);
  const validationError = validate({
    form,
    payload,
    config,
    hasKeys: resolution.value.totalKeyCount > 0,
    unconfirmedKeyCount: pins.unconfirmedUserEntityRefs.length,
  });

  const submit = async (): Promise<void> => {
    if (!payload || validationError) {
      return;
    }
    try {
      setCreated(
        await create({
          kind: form.kind,
          payload,
          title: form.title || form.file?.name || 'Untitled',
          filename: form.file?.name,
          mimeType: form.kind === 'file' ? form.file?.type || 'application/octet-stream' : 'text/plain',
          language: form.kind === 'text' ? form.language : undefined,
          recipients: resolution.value.recipients,
          recipientEntityRefs: form.recipientEntityRefs,
          expiresAt: new Date(Date.now() + form.expiresInMs),
          burnAfterRead: form.burnAfterRead,
          maxReads: form.maxReads ? Number(form.maxReads) : undefined,
          linkEnabled: form.linkEnabled,
        }),
      );
      // Pinned only once the paste has actually been sent, so an abandoned form does not
      // silently trust a key.
      pins.pinAll();
    } catch (createError) {
      errorApi.post(createError as Error);
    }
  };

  if (created) {
    return <CreatedPastePanel created={created} onCreateAnother={() => setCreated(undefined)} />;
  }

  return (
    <InfoCard title="Share a secret">
      <Grid container spacing={2}>
        <Grid item xs={12}>
          <TextField
            select
            fullWidth
            id="secure-share-kind"
            label="What are you sharing"
            value={form.kind}
            onChange={event => setForm({ ...form, kind: event.target.value as FormState['kind'] })}
          >
            <MenuItem value="text">Text or credentials</MenuItem>
            <MenuItem value="file">A file</MenuItem>
          </TextField>
        </Grid>

        <Grid item xs={12}>
          <TextField
            fullWidth
            id="secure-share-title"
            label="Title"
            helperText="Encrypted with the paste, so the backend cannot read it either"
            value={form.title}
            onChange={event => setForm({ ...form, title: event.target.value })}
          />
        </Grid>

        {form.kind === 'text' ? (
          <>
            <Grid item xs={12}>
              <TextField
                fullWidth
                multiline
                minRows={6}
                id="secure-share-content"
                label="Content"
                value={form.text}
                onChange={event => setForm({ ...form, text: event.target.value })}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField
                select
                fullWidth
                id="secure-share-language"
                label="Syntax"
                value={form.language}
                onChange={event => setForm({ ...form, language: event.target.value })}
              >
                {LANGUAGES.map(language => (
                  <MenuItem key={language} value={language}>
                    {language}
                  </MenuItem>
                ))}
              </TextField>
            </Grid>
          </>
        ) : (
          <Grid item xs={12}>
            <input
              type="file"
              aria-label="File to share"
              onChange={(event: ChangeEvent<HTMLInputElement>) => setForm({ ...form, file: event.target.files?.[0] })}
            />
            <Typography variant="caption" display="block">
              Up to {formatByteSize(config.limits.maxFileSizeBytes)}, encrypted here before it is uploaded
            </Typography>
          </Grid>
        )}

        <Grid item xs={12}>
          <RecipientPicker
            value={form.recipientEntityRefs}
            onChange={recipientEntityRefs => setForm({ ...form, recipientEntityRefs })}
            disabled={busy}
          />
        </Grid>
        <Grid item xs={12}>
          <RecipientSummary
            resolution={resolution.value}
            loading={resolution.loading}
            verdicts={pins.verdicts}
            unconfirmedUserEntityRefs={pins.unconfirmedUserEntityRefs}
            onConfirmKeys={pins.confirm}
          />
        </Grid>

        <Grid item xs={12} md={6}>
          <TextField
            select
            fullWidth
            id="secure-share-expires"
            label="Expires"
            value={form.expiresInMs}
            onChange={event => setForm({ ...form, expiresInMs: Number(event.target.value) })}
          >
            {config.expiration.optionsMs.map(optionMs => (
              <MenuItem key={optionMs} value={optionMs}>
                {formatDuration(optionMs)}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid item xs={12} md={6}>
          <TextField
            fullWidth
            id="secure-share-max-reads"
            label="Maximum reads"
            placeholder="unlimited"
            value={form.maxReads}
            onChange={event => setForm({ ...form, maxReads: event.target.value.replace(/\D/g, '') })}
          />
        </Grid>

        <Grid item xs={12}>
          <FormControlLabel
            control={
              <Checkbox
                checked={form.burnAfterRead}
                onChange={event => setForm({ ...form, burnAfterRead: event.target.checked })}
              />
            }
            label="Destroy after it has been read once"
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={form.linkEnabled}
                onChange={event => setForm({ ...form, linkEnabled: event.target.checked })}
              />
            }
            label="Also give me a secret link"
          />
        </Grid>

        {form.linkEnabled ? (
          <Grid item xs={12}>
            <Alert severity="info">
              A secret link carries the decryption key in its fragment. Anyone who receives the link can read the paste,
              so send it over a channel you trust.
            </Alert>
          </Grid>
        ) : null}

        {validationError ? (
          <Grid item xs={12}>
            <Alert severity="warning">{validationError}</Alert>
          </Grid>
        ) : null}

        <Grid item xs={12}>
          <Button color="primary" variant="contained" disabled={busy || Boolean(validationError)} onClick={submit}>
            {busy ? `Encrypting and uploading ${uploadedChunks}/${totalChunks}` : 'Encrypt and share'}
          </Button>
        </Grid>
      </Grid>
    </InfoCard>
  );
}

function validate(options: {
  form: FormState;
  payload?: Blob;
  config: ReturnType<typeof useSecureShareConfig>;
  hasKeys: boolean;
  unconfirmedKeyCount: number;
}): string | undefined {
  const { form, payload, config, hasKeys, unconfirmedKeyCount } = options;
  if (!payload || payload.size === 0) {
    return form.kind === 'file' ? 'Choose a file to share' : 'Enter the content to share';
  }
  const limit = form.kind === 'file' ? config.limits.maxFileSizeBytes : config.limits.maxTextSizeBytes;
  if (payload.size > limit) {
    return `That is ${formatByteSize(payload.size)}, more than the ${formatByteSize(limit)} allowed`;
  }
  if (!hasKeys && !form.linkEnabled) {
    return 'Pick at least one recipient with an enrolled browser, or ask for a secret link';
  }
  if (unconfirmedKeyCount > 0) {
    return 'Confirm the unrecognised device fingerprints above before sharing';
  }
  return undefined;
}
