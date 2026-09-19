import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { DefaultGithubCredentialsProvider, ScmIntegrations } from '@backstage/integration';

import { readKubespecConfig } from './config';
import { KubespecStore, metadataDir } from './database/KubespecStore';
import { GithubClient } from './github/GithubClient';
import { MetadataLoader } from './metadata/MetadataLoader';
import { SYNC_TASK_ID, createRouter } from './router';
import { KubespecSyncWorker } from './sync/KubespecSyncWorker';

/**
 * kubespecPlugin backend plugin
 *
 * @public
 */
export const kubespecPlugin = createBackendPlugin({
  pluginId: 'kubespec',
  register(env) {
    env.registerInit({
      deps: {
        config: coreServices.rootConfig,
        database: coreServices.database,
        httpAuth: coreServices.httpAuth,
        httpRouter: coreServices.httpRouter,
        logger: coreServices.logger,
        scheduler: coreServices.scheduler,
      },
      async init({ config, database, httpAuth, httpRouter, logger, scheduler }) {
        const kubespecConfig = readKubespecConfig(config);
        const store = await KubespecStore.create({ database });

        // Loaded before the router is mounted: the content ships with the code, so
        // a redeploy with an edited example takes effect without a sync run.
        await new MetadataLoader({
          store,
          logger,
          directory: kubespecConfig.metadataDir ?? metadataDir,
        }).load();

        httpRouter.use(
          await createRouter({
            httpAuth,
            store,
            scheduler,
            config: kubespecConfig,
            syncEnabled: kubespecConfig.sync.enabled,
          }),
        );

        if (!kubespecConfig.sync.enabled) {
          logger.info('Kubespec sync is disabled; the page will only show already-ingested versions');
          return;
        }

        if (!config.has('integrations.github')) {
          // Every source is a GitHub repository, so there is nothing this worker
          // could do without credentials, and failing loudly here beats a daily
          // task that quietly 401s.
          throw new Error('Kubespec sync needs an integrations.github entry, or set kubespec.sync.enabled to false');
        }

        const github = new GithubClient({
          credentials: DefaultGithubCredentialsProvider.fromIntegrations(ScmIntegrations.fromConfig(config)),
          logger,
        });

        const worker = new KubespecSyncWorker({ store, github, logger, config: kubespecConfig });

        // Defaults to scope 'global', so only one replica runs a given tick.
        await scheduler.createScheduledTaskRunner(kubespecConfig.sync.schedule).run({
          id: SYNC_TASK_ID,
          fn: async abortSignal => {
            try {
              await worker.syncOnce(abortSignal);
            } catch (error) {
              logger.error('Kubespec sync tick failed', error as Error);
            }
          },
        });
      },
    });
  },
});
