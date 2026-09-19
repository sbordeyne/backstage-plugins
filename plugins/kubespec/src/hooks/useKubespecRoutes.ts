import { useRouteRef } from '@backstage/core-plugin-api';

import { encodeGroupSegment, LATEST_VERSION, type ResourceRef } from '../lib/paths';
import { resourceRouteRef, searchRouteRef, sourceRouteRef } from '../routes';

export interface KubespecRoutes {
  sourceHref: (sourceId: string, sourceVersion?: string) => string;
  resourceHref: (ref: ResourceRef) => string;
  searchHref: () => string;
}

/**
 * Absolute links into the plugin, built from its route refs.
 *
 * Every link has to come from here rather than from a relative `../` path.
 * A relative link resolves against the current URL's depth, so the same
 * "go to this source" link lands somewhere different depending on whether it is
 * clicked from an index page or a resource page — which is exactly how the
 * source picker used to send `/kubespec/kubernetes/latest` to
 * `/kubespec/kubernetes/kyverno/latest`, and a resource page straight out of the
 * plugin to `/karpenter/latest`.
 */
export function useKubespecRoutes(): KubespecRoutes {
  const source = useRouteRef(sourceRouteRef);
  const resource = useRouteRef(resourceRouteRef);
  const search = useRouteRef(searchRouteRef);

  return {
    sourceHref: (sourceId, sourceVersion = LATEST_VERSION) => source({ sourceId, sourceVersion }),
    resourceHref: ref =>
      resource({
        sourceId: ref.sourceId,
        sourceVersion: ref.sourceVersion,
        groupSegment: encodeGroupSegment(ref.group),
        apiVersion: ref.apiVersion,
        kind: ref.kind,
      }),
    searchHref: () => search(),
  };
}
