import { ApiBlueprint, createFrontendPlugin, PageBlueprint } from '@backstage/frontend-plugin-api';
import { compatWrapper, convertLegacyRouteRefs } from '@backstage/core-compat-api';
import { configApiRef, fetchApiRef } from '@backstage/core-plugin-api';
import { scmAuthApiRef } from '@backstage/integration-react';
import PlaylistAddCheckIcon from '@material-ui/icons/PlaylistAddCheck';
import { GithubGraphqlRepositoryClient, githubRepositoryApiRef } from './api';
import { readOrganization } from './config';
import { rootRouteRef, selectedTemplateRouteRef } from './routes';

/**
 * The plugin as the new frontend system sees it.
 *
 * `title` and `icon` on the page are what put the entry in the sidebar: nav items are no longer a
 * blueprint of their own, the app infers one from every page that names itself. Dropping either
 * param removes the plugin from the nav without breaking the route.
 *
 * The route refs are the legacy ones, converted rather than redeclared, so `useRouteRef` inside the
 * table keeps resolving and the external `selectedTemplate` binding still finds the scaffolder.
 */
// Converted once and shared: the plugin's `routes.root` and the page's `routeRef` have to be the
// same object, or the page binds a path to a ref nothing else resolves.
const routes = convertLegacyRouteRefs({ root: rootRouteRef });

export default createFrontendPlugin({
  pluginId: 'integrated-repositories',
  routes,
  externalRoutes: convertLegacyRouteRefs({ selectedTemplate: selectedTemplateRouteRef }),
  extensions: [
    ApiBlueprint.make({
      params: defineParams =>
        defineParams({
          api: githubRepositoryApiRef,
          deps: { scmAuthApi: scmAuthApiRef, fetchApi: fetchApiRef, configApi: configApiRef },
          factory: ({ scmAuthApi, fetchApi, configApi }) =>
            new GithubGraphqlRepositoryClient(scmAuthApi, fetchApi, readOrganization(configApi)),
        }),
    }),
    PageBlueprint.make({
      params: {
        path: '/integrated-repositories',
        routeRef: routes.root,
        title: 'Integrated Repositories',
        icon: <PlaylistAddCheckIcon />,
        // The page still reads config and route refs through the legacy hooks, so it needs the
        // compatibility context those hooks look for.
        loader: () =>
          import('./components/IntegratedRepositoriesPage').then(m => compatWrapper(<m.IntegratedRepositoriesPage />)),
      },
    }),
  ],
});
