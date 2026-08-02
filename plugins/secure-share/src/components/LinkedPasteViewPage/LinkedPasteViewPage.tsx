import { Content, ErrorPanel, Header, Page, Progress } from '@backstage/core-components';
import Alert from '@material-ui/lab/Alert';
import { useMemo } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { PasteAccess, usePasteContent } from '../../hooks/usePasteContent';
import { PasteView } from '../PasteView';

/**
 * Opens a paste from a secret link.
 *
 * Both the link token and the data key are read from the URL fragment, which browsers do
 * not send to servers. The token is then passed as a header to fetch the ciphertext, and
 * the key never leaves this page.
 */
export function LinkedPasteViewPage(): JSX.Element {
  const { pasteId = '' } = useParams();
  const { hash } = useLocation();

  const access = useMemo<PasteAccess | undefined>(() => {
    const fragment = new URLSearchParams(hash.replace(/^#/, ''));
    const linkToken = fragment.get('t');
    const dataKey = fragment.get('k');
    return linkToken && dataKey ? { via: 'link', linkToken, dataKey } : undefined;
  }, [hash]);

  const { value, loading, error } = usePasteContent({ pasteId, access });

  return (
    <Page themeId="tool">
      <Header title="Shared secret" subtitle="Opened from a secret link" />
      <Content>
        {loading ? <Progress /> : null}
        {!access ? (
          <Alert severity="error">
            This link is missing its key. The part after the # is what decrypts the paste, and it is easy to lose when a
            link is forwarded — ask the sender for the full link.
          </Alert>
        ) : null}
        {error ? <ErrorPanel title="Could not open this paste" error={error} /> : null}
        {value ? <PasteView content={value} /> : null}
      </Content>
    </Page>
  );
}
