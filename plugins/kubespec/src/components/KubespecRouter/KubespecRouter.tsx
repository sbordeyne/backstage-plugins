import { Text } from '@backstage/ui';
import { Navigate, Route, Routes } from 'react-router-dom';

import { LATEST_VERSION } from '../../lib/paths';
import type { ScopeFilter } from '../ScopeToggle';
import { ResourcePage } from '../ResourcePage';
import { SearchPage } from '../SearchPage';
import { SourceIndexPage } from '../SourceIndexPage';

export interface KubespecRouterProps {
  defaultSourceId: string;
  /** Owned by the page shell, because the toggle that sets it is in the toolbar. */
  scope: ScopeFilter;
}

export function KubespecRouter(props: KubespecRouterProps): JSX.Element {
  return (
    <Routes>
      {/* A static segment outranks a dynamic one in react-router's ranking, so
          `search` wins over `:sourceId` regardless of the order here. */}
      <Route path="/" element={<Navigate to={`${props.defaultSourceId}/${LATEST_VERSION}`} replace />} />
      <Route path="search" element={<SearchPage />} />
      <Route path=":sourceId" element={<Navigate to={LATEST_VERSION} replace />} />
      <Route path=":sourceId/:sourceVersion" element={<SourceIndexPage scope={props.scope} />} />
      <Route path=":sourceId/:sourceVersion/:groupSegment/:apiVersion/:kind" element={<ResourcePage />} />
      <Route path="*" element={<Text>That kubespec address does not exist.</Text>} />
    </Routes>
  );
}
