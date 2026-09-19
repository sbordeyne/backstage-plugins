import { useNavigate } from 'react-router-dom';

import { LATEST_VERSION, type ResourceRef } from '../lib/paths';
import { useKubespecRoutes } from './useKubespecRoutes';

export interface GvkNavigation {
  /** Same version, different source. */
  switchSource: (sourceId: string) => void;
  /** Same source, different version. Preserves the kind when there is one. */
  switchVersion: (sourceVersion: string) => void;
  /** Rewrites the `latest` alias to the version it currently resolves to. */
  pinVersion: (concreteVersion: string) => void;
}

export interface GvkNavigationOptions {
  sourceId: string;
  sourceVersion: string;
  /**
   * Absent on the index page, where there is no kind to carry across.
   *
   * Not named `ref`: React reserves that name, so a component passing it through
   * as a prop silently receives undefined.
   */
  resource?: ResourceRef;
}

export function useGvkNavigation(options: GvkNavigationOptions): GvkNavigation {
  const navigate = useNavigate();
  const { sourceHref, resourceHref } = useKubespecRoutes();
  const { sourceId, sourceVersion, resource } = options;

  const goToVersion = (nextVersion: string, replace = false) => {
    const target = resource
      ? resourceHref({ ...resource, sourceVersion: nextVersion })
      : sourceHref(sourceId, nextVersion);

    // The version being left is remembered so the recovery page can offer an
    // exact way back rather than a guess.
    navigate(target, { replace, state: { previousVersion: sourceVersion } });
  };

  return {
    // A Deployment does not exist in cert-manager, so carrying the kind across a
    // source switch would 404 essentially every time.
    switchSource: nextSource => navigate(sourceHref(nextSource, LATEST_VERSION)),
    switchVersion: nextVersion => goToVersion(nextVersion),
    pinVersion: concreteVersion => goToVersion(concreteVersion, true),
  };
}
