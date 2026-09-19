import { Content, Header, Page } from '@backstage/core-components';
import { configApiRef, useApi } from '@backstage/core-plugin-api';
import { Flex } from '@backstage/ui';
import { useState } from 'react';

import { readKubespecConfig } from '../../config';
import { KubespecSourcesProvider, useLoadKubespecSources } from '../../hooks';
import { KubespecRouter } from '../KubespecRouter';
import { KubespecToolbar } from '../KubespecToolbar';
import type { ScopeFilter } from '../ScopeToggle';

/**
 * The page shell.
 *
 * The source list is loaded once here and shared, so the toolbar and whichever
 * page is beneath it issue one request between them rather than one each.
 */
export function KubespecPage(): JSX.Element {
  const configApi = useApi(configApiRef);
  const { defaultSourceId } = readKubespecConfig(configApi);
  const sources = useLoadKubespecSources();
  // Lifted here because the toggle lives in the toolbar and the list it filters
  // lives under the router.
  const [scope, setScope] = useState<ScopeFilter>('all');

  return (
    <Page themeId="tool">
      <Header title="Kubespec" subtitle="Kubernetes and CRD schema reference" />
      <Content>
        <KubespecSourcesProvider value={sources}>
          <Flex direction="column" gap="4">
            <KubespecToolbar defaultSourceId={defaultSourceId} scope={scope} onScopeChange={setScope} />
            <KubespecRouter defaultSourceId={defaultSourceId} scope={scope} />
          </Flex>
        </KubespecSourcesProvider>
      </Content>
    </Page>
  );
}
