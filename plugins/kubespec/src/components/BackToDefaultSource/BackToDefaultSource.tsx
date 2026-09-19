import { configApiRef, useApi } from '@backstage/core-plugin-api';
import { Link } from 'react-router-dom';

import { readKubespecConfig } from '../../config';
import { useKubespecRoutes, useKubespecSources } from '../../hooks';

export interface BackToDefaultSourceProps {
  /** The source currently being read. */
  sourceId: string;
}

/**
 * A way back to the core API from a CRD source.
 *
 * Kubernetes is where most visits start and the thing a CRD is read against, but
 * with no source picker the only route back was the grid at the foot of the index
 * page — and from a resource page there was none at all.
 *
 * Renders nothing when the default source is already open, or when it has not
 * been ingested, so the link never points at a page that would 404.
 */
export function BackToDefaultSource(props: BackToDefaultSourceProps): JSX.Element | null {
  const configApi = useApi(configApiRef);
  const { defaultSourceId } = readKubespecConfig(configApi);
  const { sources } = useKubespecSources();
  const { sourceHref } = useKubespecRoutes();

  if (props.sourceId === defaultSourceId) {
    return null;
  }

  const target = sources.find(source => source.slug === defaultSourceId);
  if (!target?.latestVersion) {
    return null;
  }

  return <Link to={sourceHref(defaultSourceId)}>← Back to {target.name}</Link>;
}
