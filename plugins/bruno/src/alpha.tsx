import { ApiBlueprint, createFrontendPlugin } from '@backstage/frontend-plugin-api';
import { EntityContentBlueprint } from '@backstage/plugin-catalog-react/alpha';
import { convertLegacyRouteRefs } from '@backstage/core-compat-api';
import { discoveryApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { brunoApiRef, BrunoReportClient } from './api';
import { isBrunoReportsAvailable } from './plugin';
import { rootRouteRef } from './routes';

// Converted once and shared, so the plugin's `routes.root` and the tab's `routeRef` are the same
// object rather than two refs that happen to look alike.
const routes = convertLegacyRouteRefs({ root: rootRouteRef });

/**
 * The plugin as the new frontend system sees it.
 *
 * The Reports tab is the plugin's own extension now, rather than a component some other package has
 * to remember to render: the entity page collects every `EntityContentBlueprint` whose filter
 * matches, so installing this plugin is all it takes for an annotated entity to grow the tab.
 *
 * `filter` is the same predicate the old composition used in its `if=`, which keeps the tab off
 * entities that carry no `happn.com/bruno-report` annotation.
 */
export default createFrontendPlugin({
  pluginId: 'bruno',
  routes,
  extensions: [
    ApiBlueprint.make({
      params: defineParams =>
        defineParams({
          api: brunoApiRef,
          deps: { discoveryApi: discoveryApiRef, fetchApi: fetchApiRef },
          factory: ({ discoveryApi, fetchApi }) => new BrunoReportClient(discoveryApi, fetchApi),
        }),
    }),
    EntityContentBlueprint.make({
      name: 'reports',
      params: {
        path: '/reports',
        title: 'Reports',
        routeRef: routes.root,
        filter: isBrunoReportsAvailable,
        loader: () => import('./components/Router').then(m => <m.Router />),
      },
    }),
  ],
});
