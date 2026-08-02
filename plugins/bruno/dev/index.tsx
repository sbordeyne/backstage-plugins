import { createDevApp } from '@backstage/dev-utils';
import { EntityProvider } from '@backstage/plugin-catalog-react';
import type { Entity } from '@backstage/catalog-model';

import { EntityBrunoContent, brunoPlugin } from '../src/plugin';

const sampleEntity: Entity = {
  apiVersion: 'backstage.io/v1alpha1',
  kind: 'Component',
  metadata: {
    name: 'sample',
    namespace: 'default',
    annotations: { 'usebruno.com/report-path': 'sample.json' },
  },
  spec: { type: 'service' },
};

// EntityBrunoContent calls useEntity(), so it needs an EntityProvider around it.
createDevApp()
  .registerPlugin(brunoPlugin)
  .addPage({
    element: (
      <EntityProvider entity={sampleEntity}>
        <EntityBrunoContent />
      </EntityProvider>
    ),
    title: 'Bruno reports',
    path: '/bruno',
  })
  .render();
