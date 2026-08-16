import {
  configApiRef,
  createApiFactory,
  createPlugin,
  createRoutableExtension,
  fetchApiRef,
} from '@backstage/core-plugin-api';
import { scmAuthApiRef } from '@backstage/integration-react';
import { GithubGraphqlRepositoryClient, githubRepositoryApiRef } from './api';
import { readOrganization } from './config';
import { rootRouteRef, selectedTemplateRouteRef } from './routes';

export const integratedRepositoriesPlugin = createPlugin({
  id: 'integrated-repositories',
  apis: [
    createApiFactory({
      api: githubRepositoryApiRef,
      deps: {
        scmAuthApi: scmAuthApiRef,
        fetchApi: fetchApiRef,
        configApi: configApiRef,
      },
      factory: ({ scmAuthApi, fetchApi, configApi }) =>
        new GithubGraphqlRepositoryClient(scmAuthApi, fetchApi, readOrganization(configApi)),
    }),
  ],
  routes: {
    root: rootRouteRef,
  },
  externalRoutes: {
    selectedTemplate: selectedTemplateRouteRef,
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
