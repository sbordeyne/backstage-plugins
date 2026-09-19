import { compatWrapper, convertLegacyRouteRefs } from '@backstage/core-compat-api';
import { discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { ApiBlueprint, PageBlueprint, createFrontendPlugin } from '@backstage/frontend-plugin-api';
import AccountTreeIcon from '@material-ui/icons/AccountTree';

import { KubespecClient, kubespecApiRef } from './api';
import { resourceRouteRef, rootRouteRef, searchRouteRef, sourceRouteRef } from './routes';

/**
 * Converted once and shared: the plugin's `routes.root` and the page's `routeRef`
 * have to be the same object, or the page binds a path to a ref nothing else
 * resolves.
 *
 * The three sub-refs travel with it so other plugins — and a future search
 * collator's result items — can deep-link to a kind without rebuilding the URL by
 * hand.
 */
const routes = convertLegacyRouteRefs({
  root: rootRouteRef,
  source: sourceRouteRef,
  resource: resourceRouteRef,
  search: searchRouteRef,
});

export default createFrontendPlugin({
  pluginId: 'kubespec',
  routes,
  extensions: [
    ApiBlueprint.make({
      params: defineParams =>
        defineParams({
          api: kubespecApiRef,
          deps: { discoveryApi: discoveryApiRef, fetchApi: fetchApiRef },
          factory: ({ discoveryApi, fetchApi }) => new KubespecClient(discoveryApi, fetchApi),
        }),
    }),
    PageBlueprint.make({
      params: {
        path: '/kubespec',
        routeRef: routes.root,
        // `title` and `icon` are what put the entry in the sidebar: nav items are
        // not a blueprint of their own, the app infers one from every page that
        // names itself. Dropping either removes it from the nav without breaking
        // the route.
        title: 'Kubespec',
        icon: <AccountTreeIcon />,
        // The page reads config through the legacy hooks, so it needs the
        // compatibility context those hooks look for.
        loader: () => import('./components/KubespecPage').then(m => compatWrapper(<m.KubespecPage />)),
      },
    }),
  ],
});
