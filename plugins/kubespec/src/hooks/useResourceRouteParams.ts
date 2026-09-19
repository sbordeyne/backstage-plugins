import { useLocation, useParams, useSearchParams } from 'react-router-dom';

import { decodeGroupSegment, type ResourceRef } from '../lib/paths';

export interface ResourceRouteParams extends ResourceRef {
  /**
   * The `#` fragment, when it names a property path.
   *
   * A fragment, not a query parameter: it is a location *within* a document,
   * which is exactly what fragments are for, and it never reaches the server so
   * it can never become part of a cache key.
   */
  focusedPath?: string;
}

export function useResourceRouteParams(): ResourceRouteParams {
  const { sourceId, sourceVersion, groupSegment, apiVersion, kind } = useParams();
  const { hash } = useLocation();

  if (!sourceId || !sourceVersion || !groupSegment || !apiVersion || !kind) {
    throw new Error('Incomplete kubespec resource route');
  }

  return {
    sourceId,
    sourceVersion,
    group: decodeGroupSegment(groupSegment),
    apiVersion,
    kind,
    focusedPath: hash.startsWith('#.') ? decodeURIComponent(hash.slice(1)) : undefined,
  };
}

export interface SourceRouteParams {
  sourceId: string;
  sourceVersion: string;
}

export function useSourceRouteParams(): SourceRouteParams {
  const { sourceId, sourceVersion } = useParams();

  if (!sourceId || !sourceVersion) {
    throw new Error('Incomplete kubespec source route');
  }

  return { sourceId, sourceVersion };
}

/** The in-page filter, kept in `?q=` so it survives a reload and can be shared. */
export function useQueryParam(name: string): [string, (value: string) => void] {
  const [params, setParams] = useSearchParams();

  const set = (value: string) => {
    const next = new URLSearchParams(params);
    if (value) {
      next.set(name, value);
    } else {
      next.delete(name);
    }
    // Replace rather than push: typing in a filter box should not fill the back
    // button with one entry per keystroke.
    setParams(next, { replace: true });
  };

  return [params.get(name) ?? '', set];
}
