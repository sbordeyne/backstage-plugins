import { useRouteRef } from '@backstage/core-plugin-api';
import { useLocation } from 'react-router-dom';

import { decodeGroupSegment, type ResourceRef } from '../lib/paths';
import { rootRouteRef } from '../routes';

export interface KubespecLocation {
  /** Absent on the plugin root and on the search page. */
  sourceId?: string;
  /** The raw segment, which may be the literal `latest`. */
  sourceVersion?: string;
  /** Present only on a resource route. */
  resource?: ResourceRef;
}

/** The one segment that is a page rather than a source. */
const SEARCH_SEGMENT = 'search';

/**
 * What the current URL says is open, read from the path rather than from route
 * params.
 *
 * The toolbar renders beside the router rather than inside it, so `useParams`
 * there matches only the plugin's own `/kubespec/*` route and reports no source
 * and no version at all. It silently fell back to the default source and to
 * `latest`, which is why the version list showed Kubernetes releases on every
 * page and the picker never moved off `latest` after a switch.
 */
export function useKubespecLocation(): KubespecLocation {
  const rootPath = useRouteRef(rootRouteRef)();
  const { pathname } = useLocation();

  const relative = pathname.startsWith(rootPath) ? pathname.slice(rootPath.length) : pathname;
  const segments = relative
    .split('/')
    .filter(Boolean)
    .map(segment => decodeURIComponent(segment));

  const [sourceId, sourceVersion, groupSegment, apiVersion, kind] = segments;

  if (!sourceId || sourceId === SEARCH_SEGMENT) {
    return {};
  }

  if (!sourceVersion) {
    return { sourceId };
  }

  if (!groupSegment || !apiVersion || !kind) {
    return { sourceId, sourceVersion };
  }

  return {
    sourceId,
    sourceVersion,
    resource: { sourceId, sourceVersion, group: decodeGroupSegment(groupSegment), apiVersion, kind },
  };
}
