import { InfoCard, Progress, ResponseErrorPanel } from '@backstage/core-components';
import { errorApiRef, useApi } from '@backstage/core-plugin-api';
import { DeviceKeySummary, formatFingerprint } from '@sbordeyne/secure-share-common';
import {
  Button,
  Chip,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@material-ui/core';
import DeleteIcon from '@material-ui/icons/Delete';
import Alert from '@material-ui/lab/Alert';
import { useCallback, useState } from 'react';
import useAsync from 'react-use/lib/useAsync';
import { secureShareApiRef } from '../../api';
import { useDeviceKey } from '../../hooks/useDeviceKey';

interface DeviceKeyRowProps {
  deviceKey: DeviceKeySummary;
  isThisBrowser: boolean;
  onRevoke: (deviceKeyId: string) => void;
}

function DeviceKeyRow({ deviceKey, isThisBrowser, onRevoke }: DeviceKeyRowProps): JSX.Element {
  return (
    <TableRow>
      <TableCell>
        {deviceKey.label}
        {isThisBrowser ? <Chip size="small" label="this browser" /> : null}
      </TableCell>
      <TableCell>
        <Typography variant="body2" component="code">
          {formatFingerprint(deviceKey.fingerprint)}
        </Typography>
      </TableCell>
      <TableCell>{new Date(deviceKey.createdAt).toLocaleString()}</TableCell>
      <TableCell>{deviceKey.lastUsedAt ? new Date(deviceKey.lastUsedAt).toLocaleString() : 'never'}</TableCell>
      <TableCell align="right">
        <Tooltip title="Revoke this device. Pastes already shared with it stay unreadable.">
          <IconButton aria-label={`Revoke ${deviceKey.label}`} onClick={() => onRevoke(deviceKey.id)} size="small">
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </TableCell>
    </TableRow>
  );
}

/**
 * Lists the browsers the current user has enrolled a key in, and enrolls this one.
 *
 * Only public halves are listed: the private key of each device never leaves the browser
 * that generated it, so this is a view of who can decrypt, not of secrets.
 */
export function DeviceKeysCard(): JSX.Element {
  const secureShareApi = useApi(secureShareApiRef);
  const errorApi = useApi(errorApiRef);
  const { deviceKey, enroll, forget, suggestedLabel, loading: enrolling, error: enrollError } = useDeviceKey();
  const [reloadToken, setReloadToken] = useState(0);
  const {
    value: deviceKeys,
    loading,
    error,
  } = useAsync(() => secureShareApi.listDeviceKeys(), [secureShareApi, reloadToken, deviceKey?.deviceKeyId]);

  const revoke = useCallback(
    async (deviceKeyId: string): Promise<void> => {
      try {
        await secureShareApi.revokeDeviceKey(deviceKeyId);
        if (deviceKeyId === deviceKey?.deviceKeyId) {
          await forget();
        }
        setReloadToken(token => token + 1);
      } catch (revokeError) {
        errorApi.post(revokeError as Error);
      }
    },
    [secureShareApi, errorApi, forget, deviceKey?.deviceKeyId],
  );

  if (loading) {
    return (
      <InfoCard title="Your devices">
        <Progress />
      </InfoCard>
    );
  }

  if (error) {
    return (
      <InfoCard title="Your devices">
        <ResponseErrorPanel title="Could not load your devices" error={error} />
      </InfoCard>
    );
  }

  return (
    <InfoCard title="Your devices">
      {enrollError ? <Alert severity="error">{enrollError.message}</Alert> : null}
      {deviceKeys?.length ? (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Device</TableCell>
              <TableCell>Fingerprint</TableCell>
              <TableCell>Enrolled</TableCell>
              <TableCell>Last used</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {deviceKeys.map(summary => (
              <DeviceKeyRow
                key={summary.id}
                deviceKey={summary}
                isThisBrowser={summary.id === deviceKey?.deviceKeyId}
                onRevoke={revoke}
              />
            ))}
          </TableBody>
        </Table>
      ) : (
        <Typography variant="body2">
          This browser has not enrolled a key yet. Enrolling generates a key pair whose private half never leaves this
          browser, which is what lets others share secrets with you.
        </Typography>
      )}

      {!deviceKey ? (
        <Button color="primary" variant="contained" disabled={enrolling} onClick={() => enroll(suggestedLabel)}>
          Enroll this browser as &quot;{suggestedLabel}&quot;
        </Button>
      ) : null}
    </InfoCard>
  );
}
