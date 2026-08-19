import { createApp } from '@backstage/frontend-defaults';
import { ApiBlueprint, createFrontendModule } from '@backstage/frontend-plugin-api';
import { CatalogApi, catalogApiRef } from '@backstage/plugin-catalog-react';
import { Entity } from '@backstage/catalog-model';
import { createRoot } from 'react-dom/client';
import secureSharePlugin from '../src/alpha';

const RECIPIENTS: Entity[] = [
  {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'User',
    metadata: { name: 'alice', namespace: 'default' },
    spec: { profile: { displayName: 'Alice Example' } },
  },
  {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'User',
    metadata: { name: 'bob', namespace: 'default' },
    spec: { profile: { displayName: 'Bob Example' } },
  },
  {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Group',
    metadata: { name: 'back-end', namespace: 'default', title: 'Back end' },
    spec: { type: 'team' },
  },
];

// The recipient picker is the only thing here that reads the catalog, and it only ever asks for
// users and groups, so a `getEntities` that ignores the filter is enough to make the form usable.
const catalogApiModule = createFrontendModule({
  pluginId: 'catalog',
  extensions: [
    ApiBlueprint.make({
      params: defineParams =>
        defineParams({
          api: catalogApiRef,
          deps: {},
          factory: () =>
            ({
              async getEntities() {
                return { items: RECIPIENTS };
              },
            } as unknown as CatalogApi),
        }),
    }),
  ],
});

const app = createApp({ features: [secureSharePlugin, catalogApiModule] });

createRoot(document.getElementById('root')!).render(app.createRoot());
