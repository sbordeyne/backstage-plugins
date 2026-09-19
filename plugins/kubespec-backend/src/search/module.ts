import { coreServices, createBackendModule } from '@backstage/backend-plugin-api';
import { searchIndexRegistryExtensionPoint } from '@backstage/plugin-search-backend-node/alpha';

import { readKubespecConfig } from '../config';
import { KubespecStore } from '../database/KubespecStore';
import { KubespecCollatorFactory } from './KubespecCollatorFactory';

/**
 * Registers kubespec kinds with the portal's global search.
 *
 * A module of the search plugin rather than part of the kubespec plugin, so the
 * whole thing can be dropped from `packages/backend` without touching the page.
 */
export const searchModuleKubespecCollator = createBackendModule({
  pluginId: 'search',
  moduleId: 'kubespec-collator',
  register(env) {
    env.registerInit({
      deps: {
        config: coreServices.rootConfig,
        database: coreServices.database,
        logger: coreServices.logger,
        indexRegistry: searchIndexRegistryExtensionPoint,
        scheduler: coreServices.scheduler,
      },
      async init({ config, database, logger, indexRegistry, scheduler }) {
        const kubespecConfig = readKubespecConfig(config);
        const store = await KubespecStore.create({ database });

        indexRegistry.addCollator({
          // Follows the ingest schedule: there is nothing new to index between
          // two syncs, so anything more frequent is pure load.
          schedule: scheduler.createScheduledTaskRunner(kubespecConfig.sync.schedule),
          factory: KubespecCollatorFactory.fromConfig({ store, logger }),
        });
      },
    });
  },
});
