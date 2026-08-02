import { Config } from '@backstage/config';
import { coreServices, createBackendModule, LoggerService, SchedulerService } from '@backstage/backend-plugin-api';
import { catalogProcessingExtensionPoint, EntityProvider } from '@backstage/plugin-catalog-node';
import {
  GcpBigQueryEntityProvider,
  GcpBucketEntityProvider,
  GcpCloudSQLEntityProvider,
  GcpClustersEntityProvider,
  GcpPubSubEntityProvider,
  GcpSecretEntityProvider,
  GcpServiceAccountEntityProvider,
} from './providers';

type GcpEntityProviderClass = new (
  logger: LoggerService,
  scheduler: SchedulerService,
  config: Config,
) => EntityProvider;

/** Config key under `catalog.providers.gcp` that turns each provider on. */
const PROVIDERS: Record<string, GcpEntityProviderClass> = {
  'service-account': GcpServiceAccountEntityProvider,
  bigquery: GcpBigQueryEntityProvider,
  pubsub: GcpPubSubEntityProvider,
  cloudsql: GcpCloudSQLEntityProvider,
  storage: GcpBucketEntityProvider,
  secretmanager: GcpSecretEntityProvider,
  clusters: GcpClustersEntityProvider,
};

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
        const gcpConfig = config.getOptionalConfig('catalog.providers.gcp');
        if (!gcpConfig) {
          logger.info('No GCP catalog provider configuration found, skipping GCP providers');
          return;
        }

        for (const [configKey, GcpEntityProvider] of Object.entries(PROVIDERS)) {
          const providerConfig = gcpConfig.getOptionalConfig(configKey);
          if (!providerConfig) {
            continue;
          }
          // `enabled: false` turns a provider off while leaving its configuration in place, so an
          // installation can stop ingesting one resource type without deleting the block it would
          // need to put back.
          if (providerConfig.getOptionalBoolean('enabled') === false) {
            logger.info(`GCP ${configKey} provider is disabled, skipping`);
            continue;
          }
          catalog.addEntityProvider(new GcpEntityProvider(logger, scheduler, config));
        }
      },
    });
  },
});
