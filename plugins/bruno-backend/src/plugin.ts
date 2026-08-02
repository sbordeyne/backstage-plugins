import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';

import { readBrunoConfig } from './config';
import { BrunoStore } from './database/BrunoStore';
import { createArtifactSource } from './sources';
import { SYNC_TASK_ID, createRouter } from './router';
import { BrunoSyncWorker } from './sync/BrunoSyncWorker';

/**
 * brunoPlugin backend plugin
 *
 * @public
 */
export const brunoPlugin = createBackendPlugin({
  pluginId: 'bruno',
  register(env) {
    env.registerInit({
      deps: {
        auth: coreServices.auth,
        catalog: catalogServiceRef,
        config: coreServices.rootConfig,
        database: coreServices.database,
        httpAuth: coreServices.httpAuth,
        httpRouter: coreServices.httpRouter,
        logger: coreServices.logger,
        scheduler: coreServices.scheduler,
      },
      async init({ auth, catalog, config, database, httpAuth, httpRouter, logger, scheduler }) {
        const brunoConfig = readBrunoConfig(config);
        const store = await BrunoStore.create({ database });

        httpRouter.use(
          await createRouter({ httpAuth, catalog, store, scheduler, syncEnabled: brunoConfig.sync.enabled }),
        );

        if (!brunoConfig.sync.enabled) {
          logger.info('Bruno GCS sync is disabled; the reports tab will only show already-synced runs');
          return;
        }

        const worker = new BrunoSyncWorker({
          store,
          source: await createArtifactSource({
            source: brunoConfig.source,
            maxObjectSizeBytes: brunoConfig.sync.maxObjectSizeBytes,
            rootConfig: config,
            logger,
          }),
          catalog,
          auth,
          logger,
          config: brunoConfig,
        });

        // Defaults to scope 'global', so only one replica runs a given tick.
        await scheduler.createScheduledTaskRunner(brunoConfig.sync.schedule).run({
          id: SYNC_TASK_ID,
          fn: async abortSignal => {
            try {
              await worker.syncOnce(abortSignal);
              logger.info('Bruno sync tick completed successfully');
            } catch (error) {
              logger.error('Bruno sync tick failed', error as Error);
            }
          },
        });
      },
    });
  },
});
