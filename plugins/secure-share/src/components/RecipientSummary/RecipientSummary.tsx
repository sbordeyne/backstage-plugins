import { parseEntityRef } from '@backstage/catalog-model';
import { humanizeEntityRef } from '@backstage/plugin-catalog-react';
import { formatFingerprint, ResolvedRecipient, ResolveRecipientsResponse } from '@sbordeyne/secure-share-common';
import { Button, Chip, Tooltip, Typography } from '@material-ui/core';
import Alert from '@material-ui/lab/Alert';
import { PinVerdict } from '../../crypto/KeyPinStore';

interface RecipientSummaryProps {
  resolution: ResolveRecipientsResponse;
  loading: boolean;
  verdicts: PinVerdict[];
  unconfirmedUserEntityRefs: string[];
  onConfirmKeys: (userEntityRef: string) => void;
}

function displayName(recipient: ResolvedRecipient): string {
  return recipient.displayName ?? humanizeEntityRef(parseEntityRef(recipient.userEntityRef), { defaultKind: 'user' });
}

function RecipientChip({ recipient }: { recipient: ResolvedRecipient }): JSX.Element {
  const deviceCount = recipient.keys.length;
  return (
    <Tooltip title={`Key fingerprints: ${recipient.keys.map(key => formatFingerprint(key.fingerprint)).join(', ')}`}>
      <Chip
        size="small"
        label={`${displayName(recipient)} · ${deviceCount} ${deviceCount === 1 ? 'device' : 'devices'}`}
      />
    </Tooltip>
  );
}

interface UnknownKeyWarningProps {
  recipient: ResolvedRecipient;
  verdict: PinVerdict;
  onConfirmKeys: (userEntityRef: string) => void;
}

/**
 * Asks the sender to confirm a device key this browser has never seen for a recipient it
 * has shared with before.
 *
 * This is the only check available against a backend that answers a key request with a key
 * it controls. It cannot tell that apart from a recipient's new laptop, so it shows the
 * fingerprint and asks for a decision rather than guessing.
 */
function UnknownKeyWarning({ recipient, verdict, onConfirmKeys }: UnknownKeyWarningProps): JSX.Element {
  const newKeys = recipient.keys
    .filter(key => verdict.newFingerprints.includes(key.fingerprint))
    .map(key => `${key.label}: ${formatFingerprint(key.fingerprint)}`);

  return (
    <Alert
      severity="warning"
      action={
        <Button size="small" onClick={() => onConfirmKeys(recipient.userEntityRef)}>
          Fingerprint checked
        </Button>
      }
    >
      {displayName(recipient)} has a device this browser has not seen before. Confirm the fingerprint with them over a
      channel this portal does not control, then continue: {newKeys.join(', ')}
    </Alert>
  );
}

/**
 * Shows who will actually be able to read the paste, who will not, and which keys are new.
 *
 * The device count matters: a data key is wrapped once per enrolled browser, and a
 * recipient who has never enrolled one cannot be given access at all.
 */
export function RecipientSummary({
  resolution,
  loading,
  verdicts,
  unconfirmedUserEntityRefs,
  onConfirmKeys,
}: RecipientSummaryProps): JSX.Element | null {
  if (loading) {
    return <Typography variant="body2">Resolving recipients…</Typography>;
  }
  if (resolution.totalKeyCount === 0 && resolution.userEntityRefsWithoutKeys.length === 0) {
    return null;
  }

  return (
    <>
      {resolution.recipients.map(recipient => (
        <RecipientChip key={recipient.userEntityRef} recipient={recipient} />
      ))}

      {resolution.recipients
        .filter(recipient => unconfirmedUserEntityRefs.includes(recipient.userEntityRef))
        .map(recipient => {
          const verdict = verdicts.find(candidate => candidate.userEntityRef === recipient.userEntityRef);
          return verdict ? (
            <UnknownKeyWarning
              key={recipient.userEntityRef}
              recipient={recipient}
              verdict={verdict}
              onConfirmKeys={onConfirmKeys}
            />
          ) : null;
        })}

      {resolution.userEntityRefsWithoutKeys.length > 0 ? (
        <Alert severity="warning">
          {resolution.userEntityRefsWithoutKeys.length} of these people have not enrolled a browser yet and will not be
          able to read this paste:{' '}
          {resolution.userEntityRefsWithoutKeys
            .map(entityRef => humanizeEntityRef(parseEntityRef(entityRef), { defaultKind: 'user' }))
            .join(', ')}
        </Alert>
      ) : null}

      {resolution.unresolvedEntityRefs.length > 0 ? (
        <Alert severity="error">Unknown in the catalog: {resolution.unresolvedEntityRefs.join(', ')}</Alert>
      ) : null}
    </>
  );
}
