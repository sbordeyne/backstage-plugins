import { useApi } from '@backstage/core-plugin-api';
import type {
  KubespecChangeSummary,
  KubespecVersionSummary,
  KubespecMetadata,
  KubespecResourceDefinition,
  KubespecResourceEnvelope,
  KubespecResourceListResponse,
} from '@sbordeyne/kubespec-common';
import useAsync from 'react-use/lib/useAsync';

import { kubespecApiRef } from '../api';
import { apiVersionFull, type ResourceRef } from '../lib/paths';

export interface AsyncValue<T> {
  value?: T;
  loading: boolean;
  error?: Error;
}

export function useResourceList(sourceId: string, sourceVersion: string): AsyncValue<KubespecResourceListResponse> {
  const api = useApi(kubespecApiRef);
  return useAsync(
    () => api.listResources({ sourceId, sourceVersion }),
    [api, sourceId, sourceVersion],
  ) as AsyncValue<KubespecResourceListResponse>;
}

/**
 * The versions of one source, newest first.
 *
 * Ordering is entirely the backend's — nothing here re-implements version
 * comparison, which is the one way the picker and the data behind it could
 * disagree about what "newest" means.
 */
export function useSourceVersions(sourceId: string): AsyncValue<KubespecVersionSummary[]> {
  const api = useApi(kubespecApiRef);

  return useAsync(async () => {
    const page = await api.listVersions({ sourceId, limit: 100 });
    return page.items;
  }, [api, sourceId]) as AsyncValue<KubespecVersionSummary[]>;
}

export interface ResourceData {
  envelope?: KubespecResourceEnvelope;
  definition?: KubespecResourceDefinition;
  loading: boolean;
  error?: Error;
}

/**
 * A kind's envelope and its schema.
 *
 * Two requests, issued together rather than in sequence: the envelope is small
 * and paints the header immediately, while the schema is served as the gzip the
 * backend stored and can be revalidated by its own ETag.
 */
export function useResourceDetail(ref: ResourceRef): ResourceData {
  const api = useApi(kubespecApiRef);
  const key = [ref.sourceId, ref.sourceVersion, ref.group, ref.apiVersion, ref.kind].join('|');

  const { value, loading, error } = useAsync(async () => {
    const [envelope, definition] = await Promise.all([api.getResource({ ref }), api.getSchema({ ref })]);
    return { envelope, definition };
  }, [api, key]);

  return { envelope: value?.envelope, definition: value?.definition, loading, error };
}

export function useChangeSummaries(ref: ResourceRef, enabled: boolean): AsyncValue<KubespecChangeSummary[]> {
  const api = useApi(kubespecApiRef);
  const key = [ref.sourceId, ref.sourceVersion, ref.group, ref.apiVersion, ref.kind].join('|');

  return useAsync(async () => {
    if (!enabled) {
      return [];
    }
    return api.listChangeSummaries({ ref });
  }, [api, key, enabled]) as AsyncValue<KubespecChangeSummary[]>;
}

export function useResourceMetadata(ref: ResourceRef, enabled: boolean): AsyncValue<KubespecMetadata> {
  const api = useApi(kubespecApiRef);

  return useAsync(async () => {
    if (!enabled) {
      return { examples: [], links: [] };
    }
    return api.getMetadata({
      sourceId: ref.sourceId,
      apiVersionFull: apiVersionFull(ref.group, ref.apiVersion),
      kind: ref.kind,
    });
  }, [api, ref.sourceId, ref.group, ref.apiVersion, ref.kind, enabled]) as AsyncValue<KubespecMetadata>;
}
