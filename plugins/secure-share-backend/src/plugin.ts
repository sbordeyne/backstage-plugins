import { coreServices, createBackendPlugin } from '@backstage/backend-plugin-api';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import { readSecureShareBackendConfig } from './config';
import { DeviceKeyStore } from './database/DeviceKeyStore';
import { initializeDatabase } from './database/initializeDatabase';
import { PasteStore } from './database/PasteStore';
import { createRouter } from './router';
import { DeviceKeyService } from './services/DeviceKeyService';
import { PastePurger } from './services/PastePurger';
import { PasteService } from './services/PasteService';
import { RecipientResolver } from './services/RecipientResolver';
import { CHUNK_CRYPTO_OVERHEAD_BYTES } from './services/pasteValidation';
import { createBlobStore } from './storage';

const PURGE_TASK_ID = 'secure-share-purge-expired';

/**
 * Backend for the secure-share plugin: stores encrypted pastes and the device public
 * keys they are wrapped for. It never receives a data key, a private key or plaintext.
 *
 * @public
 */
export const secureSharePlugin = createBackendPlugin({
  pluginId: 'secure-share',
  register(env) {
    env.registerInit({
      deps: {
        catalog: catalogServiceRef,
        config: coreServices.rootConfig,
        database: coreServices.database,
        httpAuth: coreServices.httpAuth,
        httpRouter: coreServices.httpRouter,
        logger: coreServices.logger,
        scheduler: coreServices.scheduler,
      },
      async init({ catalog, config, database, httpAuth, httpRouter, logger, scheduler }) {
        const secureShareConfig = readSecureShareBackendConfig(config);
        const client = await initializeDatabase(database);
        const blobStore = createBlobStore({ config: secureShareConfig.storage, logger });
        const deviceKeyStore = DeviceKeyStore.create(client);
        const pasteStore = PasteStore.create(client);

        const deviceKeys = DeviceKeyService.create({
          store: deviceKeyStore,
          recipientResolver: RecipientResolver.create({ catalog, logger }),
          logger,
          maxDeviceKeysPerUser: secureShareConfig.maxDeviceKeysPerUser,
          maxRecipientKeys: secureShareConfig.shared.limits.maxRecipientKeys,
        });

        const pastes = PasteService.create({
          pastes: pasteStore,
          deviceKeys: deviceKeyStore,
          blobStore,
          config: secureShareConfig.shared,
          burnGracePeriodMs: secureShareConfig.cleanup.burnGracePeriodMs,
          logger,
        });

        const purger = PastePurger.create({
          pastes: pasteStore,
          blobStore,
          burnGracePeriodMs: secureShareConfig.cleanup.burnGracePeriodMs,
          logger,
        });
        await scheduler.scheduleTask({
          id: PURGE_TASK_ID,
          frequency: secureShareConfig.cleanup.frequency,
          timeout: { minutes: 5 },
          fn: async () => {
            await purger.purge();
          },
        });

        // Reading through a secret link is by design not tied to a Backstage identity:
        // the link holder proves nothing but possession of the token, and the data key
        // they need lives in the URL fragment, which never reaches this backend.
        httpRouter.addAuthPolicy({ path: '/link', allow: 'unauthenticated' });
        httpRouter.use(
          await createRouter({
            httpAuth,
            deviceKeys,
            pastes,
            maxChunkBytes: secureShareConfig.shared.limits.chunkSizeBytes + CHUNK_CRYPTO_OVERHEAD_BYTES,
          }),
        );
      },
    });
  },
});
