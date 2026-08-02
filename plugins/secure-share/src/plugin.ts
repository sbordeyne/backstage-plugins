import {
  createApiFactory,
  createPlugin,
  createRoutableExtension,
  discoveryApiRef,
  fetchApiRef,
} from '@backstage/core-plugin-api';
import { createCardExtension } from '@backstage/plugin-home-react';
import { secureShareApiRef, SecureShareClient } from './api';
import { linkedPasteRouteRef, pasteRouteRef, rootRouteRef } from './routes';

export const secureSharePlugin = createPlugin({
  id: 'secure-share',
  apis: [
    createApiFactory({
      api: secureShareApiRef,
      deps: { discoveryApi: discoveryApiRef, fetchApi: fetchApiRef },
      factory: ({ discoveryApi, fetchApi }) => new SecureShareClient({ discoveryApi, fetchApi }),
    }),
  ],
  routes: {
    root: rootRouteRef,
    paste: pasteRouteRef,
    link: linkedPasteRouteRef,
  },
});

export const SecureSharePage = secureSharePlugin.provide(
  createRoutableExtension({
    name: 'SecureSharePage',
    component: () => import('./components/Router').then(m => m.Router),
    mountPoint: rootRouteRef,
  }),
);

/**
 * Homepage card listing the secrets most recently shared with the signed in user.
 *
 * `limit` overrides `secureShare.card.limit`.
 */
export const SecureShareSharedWithMeCard = secureSharePlugin.provide(
  createCardExtension<{ limit?: number }>({
    name: 'SecureShareSharedWithMeCard',
    title: 'Shared with me',
    description: 'Secrets recently shared with you, decrypted in your browser',
    components: () => import('./components/SharedWithMeCard').then(m => ({ Content: m.SharedWithMeCard })),
  }),
);
