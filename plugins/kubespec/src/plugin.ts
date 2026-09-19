import {
  createApiFactory,
  createPlugin,
  createRoutableExtension,
  discoveryApiRef,
  fetchApiRef,
} from '@backstage/core-plugin-api';

import { KubespecClient, kubespecApiRef } from './api';
import { rootRouteRef } from './routes';

/**
 * The legacy plugin.
 *
 * The app consumes `/alpha`; this exists so the dev harness and any legacy
 * consumer can still register the page and its API.
 */
export const kubespecPlugin = createPlugin({
  id: 'kubespec',
  apis: [
    createApiFactory({
      api: kubespecApiRef,
      deps: { discoveryApi: discoveryApiRef, fetchApi: fetchApiRef },
      factory: ({ discoveryApi, fetchApi }) => new KubespecClient(discoveryApi, fetchApi),
    }),
  ],
  routes: { root: rootRouteRef },
});

export const KubespecPageExtension = kubespecPlugin.provide(
  createRoutableExtension({
    name: 'KubespecPage',
    component: () => import('./components/KubespecPage').then(m => m.KubespecPage),
    mountPoint: rootRouteRef,
  }),
);
