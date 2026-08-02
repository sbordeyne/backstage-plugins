import { Content, ErrorPanel, Header, Page, Progress } from '@backstage/core-components';
import Alert from '@material-ui/lab/Alert';
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useDeviceKey } from '../../hooks/useDeviceKey';
import { PasteAccess, usePasteContent } from '../../hooks/usePasteContent';
import { PasteView } from '../PasteView';

/**
 * Opens a paste shared with the signed in user, using this browser's device key.
 */
export function PasteViewPage(): JSX.Element {
  const { pasteId = '' } = useParams();
  const { deviceKey, loading: deviceKeyLoading } = useDeviceKey();

  const access = useMemo<PasteAccess | undefined>(
    () =>
      deviceKey
        ? { via: 'recipient', deviceKeyId: deviceKey.deviceKeyId, privateKey: deviceKey.privateKey }
        : undefined,
    [deviceKey],
  );
  const { value, loading, error } = usePasteContent({ pasteId, access });

  return (
    <Page themeId="tool">
      <Header title="Shared secret" />
      <Content>
        {deviceKeyLoading || loading ? <Progress /> : null}
        {!deviceKeyLoading && !deviceKey ? (
          <Alert severity="info">
            This browser has no enrolled key, so it cannot decrypt anything. Enroll it on the secure share page, then
            ask the sender to share again — pastes are wrapped for the browsers that existed when they were sent.
          </Alert>
        ) : null}
        {error ? <ErrorPanel title="Could not open this paste" error={error} /> : null}
        {value ? <PasteView content={value} /> : null}
      </Content>
    </Page>
  );
}
