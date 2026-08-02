import { coreServices, createBackendModule } from '@backstage/backend-plugin-api';
import { catalogProcessingExtensionPoint } from '@backstage/plugin-catalog-node';
import {
  GcpBigQueryEntityProvider,
  GcpBucketEntityProvider,
  GcpCloudSQLEntityProvider,
  GcpPubSubEntityProvider,
  GcpSecretEntityProvider,
} from './providers';
import { GcpServiceAccountEntityProvider } from './providers/GcpServiceAccountEntityProvider';
import { GcpClustersEntityProvider } from './providers/GcpClustersEntityProvider';

export const catalogModuleGcpProvider = createBackendModule({
  pluginId: 'catalog',
  moduleId: 'gcp-provider',
  register(reg) {
    reg.registerInit({
      deps: {
        config: coreServices.rootConfig,
        catalog: catalogProcessingExtensionPoint,
        logger: coreServices.logger,
        scheduler: coreServices.scheduler,
      },
      async init({ config, catalog, logger, scheduler }) {
        if (!config.has('catalog.providers.gcp')) {
          logger.info('No GCP catalog provider configuration found, skipping GCP providers');
          return;
        }
        if (config.has('catalog.providers.gcp.service-account')) {
          catalog.addEntityProvider(new GcpServiceAccountEntityProvider(logger, scheduler, config));
        }
        if (config.has('catalog.providers.gcp.bigquery')) {
          catalog.addEntityProvider(new GcpBigQueryEntityProvider(logger, scheduler, config));
        }
        if (config.has('catalog.providers.gcp.pubsub')) {
          catalog.addEntityProvider(new GcpPubSubEntityProvider(logger, scheduler, config));
        }
        if (config.has('catalog.providers.gcp.cloudsql')) {
          catalog.addEntityProvider(new GcpCloudSQLEntityProvider(logger, scheduler, config));
        }
        if (config.has('catalog.providers.gcp.storage')) {
          catalog.addEntityProvider(new GcpBucketEntityProvider(logger, scheduler, config));
        }
        if (config.has('catalog.providers.gcp.secretmanager')) {
          catalog.addEntityProvider(new GcpSecretEntityProvider(logger, scheduler, config));
        }
        if (config.has('catalog.providers.gcp.clusters')) {
          catalog.addEntityProvider(new GcpClustersEntityProvider(logger, scheduler, config));
        }
      },
    });
  },
});
