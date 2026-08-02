import { createApiFactory, createPlugin, createRoutableExtension, fetchApiRef } from '@backstage/core-plugin-api';
import { scmAuthApiRef, scmIntegrationsApiRef } from '@backstage/integration-react';
import { GithubGraphqlRepositoryClient, githubRepositoryApiRef } from './api';
import { rootRouteRef } from './routes';

export const integratedRepositoriesPlugin = createPlugin({
  id: 'integrated-repositories',
  apis: [
    createApiFactory({
      api: githubRepositoryApiRef,
      deps: {
        scmAuthApi: scmAuthApiRef,
        scmIntegrations: scmIntegrationsApiRef,
        fetchApi: fetchApiRef,
      },
      factory: ({ scmAuthApi, scmIntegrations, fetchApi }) =>
        new GithubGraphqlRepositoryClient(scmAuthApi, scmIntegrations, fetchApi),
    }),
  ],
  routes: {
    root: rootRouteRef,
  },
});

/**
 * Standalone page tracking how much of the GitHub organization is covered by the catalog.
 */
export const IntegratedRepositoriesPage = integratedRepositoriesPlugin.provide(
  createRoutableExtension({
    name: 'IntegratedRepositoriesPage',
    component: () => import('./components/IntegratedRepositoriesPage').then(m => m.IntegratedRepositoriesPage),
    mountPoint: rootRouteRef,
  }),
);
