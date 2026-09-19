import { useApi } from '@backstage/core-plugin-api';
import type { KubespecSourceSummary } from '@sbordeyne/kubespec-common';
import { createContext, useContext } from 'react';
import useAsync from 'react-use/lib/useAsync';

import { kubespecApiRef } from '../api';

export interface KubespecSources {
  sources: KubespecSourceSummary[];
  loading: boolean;
  error?: Error;
}

/**
 * Shared so the toolbar and the page beneath it issue one request between them
 * rather than one each.
 */
const KubespecSourcesContext = createContext<KubespecSources | undefined>(undefined);

export const KubespecSourcesProvider = KubespecSourcesContext.Provider;

export function useLoadKubespecSources(): KubespecSources {
  const api = useApi(kubespecApiRef);
  const { value, loading, error } = useAsync(() => api.listSources(), [api]);

  return { sources: value ?? [], loading, error };
}

export function useKubespecSources(): KubespecSources {
  const context = useContext(KubespecSourcesContext);
  if (!context) {
    throw new Error('useKubespecSources must be used inside the kubespec page');
  }
  return context;
}

export function findSource(
  sources: readonly KubespecSourceSummary[],
  sourceId: string,
): KubespecSourceSummary | undefined {
  return sources.find(source => source.slug === sourceId);
}
