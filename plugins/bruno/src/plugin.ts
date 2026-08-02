import {
  createApiFactory,
  createPlugin,
  createRoutableExtension,
  discoveryApiRef,
  fetchApiRef,
} from '@backstage/core-plugin-api';
import { Entity } from '@backstage/catalog-model';

import { brunoApiRef, BrunoReportClient } from './api';
import { rootRouteRef } from './routes';

export const BRUNO_REPORT_ANNOTATION = 'usebruno.com/report-path';

export const brunoPlugin = createPlugin({
  id: 'bruno',
  apis: [
    createApiFactory({
      api: brunoApiRef,
      deps: { discoveryApi: discoveryApiRef, fetchApi: fetchApiRef },
      factory: ({ discoveryApi, fetchApi }) => new BrunoReportClient(discoveryApi, fetchApi),
    }),
  ],
  routes: {
    root: rootRouteRef,
  },
});

export function isBrunoReportsAvailable(entity: Entity): boolean {
  if (entity.kind !== 'Component' && entity.kind !== 'System') {
    return false;
  }
  return entity.metadata.annotations?.[BRUNO_REPORT_ANNOTATION] !== undefined;
}

export const EntityBrunoContent = brunoPlugin.provide(
  createRoutableExtension({
    name: 'EntityBrunoContent',
    component: () => import('./components/Router').then(m => m.Router),
    mountPoint: rootRouteRef,
  }),
);
