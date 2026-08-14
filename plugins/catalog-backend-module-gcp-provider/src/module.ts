import { Config } from '@backstage/config';
import { coreServices, createBackendModule, LoggerService, SchedulerService } from '@backstage/backend-plugin-api';
import { catalogProcessingExtensionPoint, EntityProvider } from '@backstage/plugin-catalog-node';
import { google } from 'googleapis';
import { GcpRelationProcessor } from './processors/GcpRelationProcessor';
import { GcpAssetIndex } from './iam';
import type { GcpAssetIndexFactory } from './providers/GcpEntityProviderBase';
import { createGoogleAuth } from './googleAuth';
import {
  GcpAddressEntityProvider,
  GcpAlloyDbEntityProvider,
  GcpAnalyticsHubEntityProvider,
  GcpAppEngineEntityProvider,
  GcpArmorEntityProvider,
  GcpArtifactRegistryEntityProvider,
  GcpBigQueryEntityProvider,
  GcpBigQueryReservationEntityProvider,
  GcpBigQueryTransferEntityProvider,
  GcpBigtableEntityProvider,
  GcpBinaryAuthorizationEntityProvider,
  GcpBucketEntityProvider,
  GcpCertificateManagerEntityProvider,
  GcpCloudBuildEntityProvider,
  GcpCloudDeployEntityProvider,
  GcpCloudFunctionEntityProvider,
  GcpCloudRunEntityProvider,
  GcpCloudSQLEntityProvider,
  GcpCloudTasksEntityProvider,
  GcpClustersEntityProvider,
  GcpComposerEntityProvider,
  GcpComputeInstanceEntityProvider,
  GcpDataflowEntityProvider,
  GcpDataplexEntityProvider,
  GcpDataprocEntityProvider,
  GcpDatastreamEntityProvider,
  GcpDiskEntityProvider,
  GcpDnsEntityProvider,
  GcpEventarcEntityProvider,
  GcpFilestoreEntityProvider,
  GcpFirestoreEntityProvider,
  GcpFirewallEntityProvider,
  GcpIamRoleEntityProvider,
  GcpImageEntityProvider,
  GcpInstanceGroupEntityProvider,
  GcpKafkaEntityProvider,
  GcpKmsEntityProvider,
  GcpLoadBalancerEntityProvider,
  GcpLogSinkEntityProvider,
  GcpMemcacheEntityProvider,
  GcpMonitoringEntityProvider,
  GcpPubSubEntityProvider,
  GcpRedisEntityProvider,
  GcpRouterEntityProvider,
  GcpSchedulerEntityProvider,
  GcpSecretEntityProvider,
  GcpServiceAccountEntityProvider,
  GcpSloEntityProvider,
  GcpSpannerEntityProvider,
  GcpSslCertificateEntityProvider,
  GcpSubnetEntityProvider,
  GcpVertexEntityProvider,
  GcpVpcConnectorEntityProvider,
  GcpVpcEntityProvider,
  GcpVpnEntityProvider,
  GcpWorkbenchEntityProvider,
  GcpWorkflowEntityProvider,
  GcpWorkloadIdentityEntityProvider,
} from './providers';

type GcpEntityProviderClass = new (
  logger: LoggerService,
  scheduler: SchedulerService,
  config: Config,
  assetIndex: GcpAssetIndexFactory,
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

  // The IAM access graph: Workload Identity bridges Kubernetes workloads to Google identities,
  // whose grants are relations on the service-account entities themselves.
  'workload-identity': GcpWorkloadIdentityEntityProvider,
  'iam-roles': GcpIamRoleEntityProvider,

  // Networking and compute.
  vpc: GcpVpcEntityProvider,
  subnets: GcpSubnetEntityProvider,
  firewall: GcpFirewallEntityProvider,
  routers: GcpRouterEntityProvider,
  dns: GcpDnsEntityProvider,
  instances: GcpComputeInstanceEntityProvider,
  'instance-groups': GcpInstanceGroupEntityProvider,
  images: GcpImageEntityProvider,

  // Load balancing and the network edge.
  loadbalancers: GcpLoadBalancerEntityProvider,
  sslcertificates: GcpSslCertificateEntityProvider,
  armor: GcpArmorEntityProvider,
  addresses: GcpAddressEntityProvider,
  vpn: GcpVpnEntityProvider,

  // CI/CD and orchestration.
  cloudbuild: GcpCloudBuildEntityProvider,
  clouddeploy: GcpCloudDeployEntityProvider,
  workflows: GcpWorkflowEntityProvider,
  composer: GcpComposerEntityProvider,
  dataproc: GcpDataprocEntityProvider,

  // Security and keys.
  kms: GcpKmsEntityProvider,
  certificatemanager: GcpCertificateManagerEntityProvider,
  binaryauthorization: GcpBinaryAuthorizationEntityProvider,

  // Observability.
  alerts: GcpMonitoringEntityProvider,
  slos: GcpSloEntityProvider,
  logsinks: GcpLogSinkEntityProvider,

  // Misc infrastructure.
  filestore: GcpFilestoreEntityProvider,
  vpcconnectors: GcpVpcConnectorEntityProvider,
  memcache: GcpMemcacheEntityProvider,
  appengine: GcpAppEngineEntityProvider,
  disks: GcpDiskEntityProvider,

  // Data platform.
  bqtransfers: GcpBigQueryTransferEntityProvider,
  bqreservations: GcpBigQueryReservationEntityProvider,
  analyticshub: GcpAnalyticsHubEntityProvider,
  datastream: GcpDatastreamEntityProvider,
  dataplex: GcpDataplexEntityProvider,
  dataflow: GcpDataflowEntityProvider,

  // Vertex AI and ML.
  vertex: GcpVertexEntityProvider,
  workbench: GcpWorkbenchEntityProvider,

  // Databases.
  spanner: GcpSpannerEntityProvider,
  redis: GcpRedisEntityProvider,
  alloydb: GcpAlloyDbEntityProvider,
  bigtable: GcpBigtableEntityProvider,
  firestore: GcpFirestoreEntityProvider,

  // Messaging and eventing.
  managedkafka: GcpKafkaEntityProvider,
  eventarc: GcpEventarcEntityProvider,
  cloudtasks: GcpCloudTasksEntityProvider,
  scheduler: GcpSchedulerEntityProvider,

  // Serverless and artifacts.
  run: GcpCloudRunEntityProvider,
  functions: GcpCloudFunctionEntityProvider,
  artifactregistry: GcpArtifactRegistryEntityProvider,
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

        // One index for the whole backend: providers refresh on independent schedules, and sharing
        // it is what keeps thirty providers waking up within a TTL of each other to one Cloud Asset
        // sweep per project rather than thirty.
        //
        // Built on first use, so an installation with `iam.enabled: false` never constructs a
        // Cloud Asset client or resolves credentials for it.
        const iam = gcpConfig.getOptionalConfig('iam');
        let index: GcpAssetIndex | undefined;
        const assetIndex = () =>
          (index ??= new GcpAssetIndex(google.cloudasset({ version: 'v1', auth: createGoogleAuth(logger) }), logger, {
            cacheTtlMs: (iam?.getOptionalNumber('cacheTtlSeconds') ?? 600) * 1000,
            maxBindings: iam?.getOptionalNumber('maxBindingsPerProject') ?? 20000,
          }));

        // Custom relation types have no spec field to travel in, so the ones this module emits —
        // `accessorOf`, `publishedToBy`, `attachedTo` and the rest — come from a processor. It is
        // registered unconditionally and does nothing at all unless `iam.relations: gcp`.
        catalog.addProcessor(new GcpRelationProcessor(config, logger, assetIndex));

        const registered: string[] = [];
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
          catalog.addEntityProvider(new GcpEntityProvider(logger, scheduler, config, assetIndex));
          registered.push(configKey);
        }

        if (registered.length === 0) {
          // A provider block has to be a mapping — `storage: {}` at the very least. Backstage's
          // config loader drops a key whose value is null before this module can see it, so a bare
          // `storage:` is indistinguishable from no `storage` key at all and would otherwise be
          // silently ignored. Saying so here is the only place it can be caught.
          logger.warn(
            'A catalog.providers.gcp block is configured but no provider was registered. A provider ' +
              "is enabled by a mapping under its config key — write 'storage: {}', not a bare " +
              "'storage:', which the config loader discards.",
          );
        }
      },
    });
  },
});
