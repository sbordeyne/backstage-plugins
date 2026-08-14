/**
 * Every resource type this module ingests, in one table.
 *
 * A resource type used to be spelled out in four places that had to agree — the provider registry
 * in `module.ts`, the documentation links in `links.ts`, the Cloud Asset Inventory registry in
 * `iam/assetTypes.ts` and the README — and they drifted: most types ended up with no documentation
 * link although links are on by default, and several with a real asset type had no entry, so IAM
 * bindings on them resolved to nothing and the edge was silently dropped.
 *
 * Those registries are now derived from this one. `docsUrl` is required, so a type added without a
 * documentation link does not compile, and `assetType` has to be written out — as a value or as an
 * explicit omission with the reason — so "this resource has no IAM policy of its own" is a decision
 * rather than an oversight.
 */

/** How the entity name is derived when the leaf of a Cloud Asset Inventory name is not it. */
export type GcpNameStyle = 'subnet' | 'pubsub' | 'pubsubSubscription' | 'serviceAccount';

/** One ingested resource type. */
export interface GcpResourceType {
  /** `spec.type` of the entity, e.g. `bucket`. */
  type: string;
  /** Config key of the provider that owns the type, for its namespace template. */
  configKey: string;
  /** Name of that provider, available to templates as `{{provider}}`. */
  provider: string;
  /** Product documentation for the type, written onto every entity as a link. */
  docsUrl: string;
  /**
   * Cloud Asset Inventory type, when the resource has an IAM policy of its own. Without one, a
   * binding naming this resource produces no relation.
   */
  assetType?: string;
  /** Name derivation, when the leaf of the asset name is not the entity name. */
  nameStyle?: GcpNameStyle;
  /**
   * Host Cloud Asset Inventory names this resource under, when it is not the one `assetType` is
   * prefixed with — Cloud SQL is `sqladmin.googleapis.com/Instance` but
   * `//cloudsql.googleapis.com/…`.
   */
  assetHost?: string;
}

export const RESOURCE_TYPES: GcpResourceType[] = [
  // Storage, data and messaging.
  {
    type: 'bucket',
    configKey: 'storage',
    provider: 'gcp-bucket',
    docsUrl: 'https://cloud.google.com/storage/docs/buckets',
    assetType: 'storage.googleapis.com/Bucket',
  },
  {
    type: 'bigquery-dataset',
    configKey: 'bigquery',
    provider: 'gcp-bigquery',
    docsUrl: 'https://cloud.google.com/bigquery/docs/datasets-intro',
    assetType: 'bigquery.googleapis.com/Dataset',
  },
  {
    type: 'pubsub-topic',
    configKey: 'pubsub',
    provider: 'gcp-pubsub',
    docsUrl: 'https://cloud.google.com/pubsub/docs/overview',
    assetType: 'pubsub.googleapis.com/Topic',
    nameStyle: 'pubsub',
  },
  {
    type: 'pubsub-subscription',
    configKey: 'pubsub',
    provider: 'gcp-pubsub',
    docsUrl: 'https://cloud.google.com/pubsub/docs/subscriber',
    assetType: 'pubsub.googleapis.com/Subscription',
    nameStyle: 'pubsubSubscription',
  },
  {
    type: 'secret',
    configKey: 'secretmanager',
    provider: 'gcp-secret-manager',
    docsUrl: 'https://cloud.google.com/secret-manager/docs',
    assetType: 'secretmanager.googleapis.com/Secret',
  },

  // Identity.
  {
    type: 'google-service-account',
    configKey: 'service-account',
    provider: 'gcp-service-account',
    docsUrl: 'https://cloud.google.com/iam/docs/service-account-overview',
    assetType: 'iam.googleapis.com/ServiceAccount',
    nameStyle: 'serviceAccount',
  },
  {
    type: 'iam-role',
    configKey: 'iam-roles',
    provider: 'gcp-iam-roles',
    docsUrl: 'https://cloud.google.com/iam/docs/creating-custom-roles',
    assetType: 'iam.googleapis.com/Role',
  },
  {
    type: 'kubernetes-service-account',
    configKey: 'workload-identity',
    provider: 'gcp-workload-identity',
    docsUrl: 'https://cloud.google.com/kubernetes-engine/docs/concepts/workload-identity',
    // A Kubernetes account is not a GCP resource; it exists here only as the far side of a
    // workloadIdentityUser binding, so nothing ever names it as an asset.
  },

  // Compute and containers.
  {
    type: 'kubernetes-cluster',
    configKey: 'clusters',
    provider: 'gcp-clusters',
    docsUrl: 'https://cloud.google.com/kubernetes-engine/docs',
    assetType: 'container.googleapis.com/Cluster',
  },
  {
    type: 'compute-instance',
    configKey: 'instances',
    provider: 'gcp-instances',
    docsUrl: 'https://cloud.google.com/compute/docs/instances',
    assetType: 'compute.googleapis.com/Instance',
  },
  {
    type: 'instance-group',
    configKey: 'instance-groups',
    provider: 'gcp-instance-groups',
    docsUrl: 'https://cloud.google.com/compute/docs/instance-groups',
    assetType: 'compute.googleapis.com/InstanceGroupManager',
  },
  {
    type: 'compute-image',
    configKey: 'images',
    provider: 'gcp-images',
    docsUrl: 'https://cloud.google.com/compute/docs/images',
    assetType: 'compute.googleapis.com/Image',
  },
  {
    type: 'disk',
    configKey: 'disks',
    provider: 'gcp-disks',
    docsUrl: 'https://cloud.google.com/compute/docs/disks',
    assetType: 'compute.googleapis.com/Disk',
  },
  {
    type: 'snapshot',
    configKey: 'disks',
    provider: 'gcp-disks',
    docsUrl: 'https://cloud.google.com/compute/docs/disks/create-snapshots',
    assetType: 'compute.googleapis.com/Snapshot',
  },
  {
    type: 'appengine-service',
    configKey: 'appengine',
    provider: 'gcp-appengine',
    docsUrl: 'https://cloud.google.com/appengine/docs/standard/an-overview-of-app-engine',
    assetType: 'appengine.googleapis.com/Service',
  },

  // Networking.
  {
    type: 'vpc-network',
    configKey: 'vpc',
    provider: 'gcp-vpc',
    docsUrl: 'https://cloud.google.com/vpc/docs/vpc',
    assetType: 'compute.googleapis.com/Network',
  },
  {
    type: 'subnetwork',
    configKey: 'subnets',
    provider: 'gcp-subnets',
    docsUrl: 'https://cloud.google.com/vpc/docs/subnets',
    assetType: 'compute.googleapis.com/Subnetwork',
    nameStyle: 'subnet',
  },
  {
    type: 'firewall-rule',
    configKey: 'firewall',
    provider: 'gcp-firewall',
    docsUrl: 'https://cloud.google.com/firewall/docs/firewalls',
    assetType: 'compute.googleapis.com/Firewall',
  },
  {
    type: 'cloud-router',
    configKey: 'routers',
    provider: 'gcp-routers',
    docsUrl: 'https://cloud.google.com/network-connectivity/docs/router/concepts/overview',
    assetType: 'compute.googleapis.com/Router',
  },
  {
    type: 'cloud-nat',
    configKey: 'routers',
    provider: 'gcp-routers',
    docsUrl: 'https://cloud.google.com/nat/docs/overview',
    // A NAT gateway is configuration on a router rather than a resource, so it holds no policy.
  },
  {
    type: 'dns-zone',
    configKey: 'dns',
    provider: 'gcp-dns',
    docsUrl: 'https://cloud.google.com/dns/docs/zones',
    assetType: 'dns.googleapis.com/ManagedZone',
  },
  {
    type: 'ip-address',
    configKey: 'addresses',
    provider: 'gcp-addresses',
    docsUrl: 'https://cloud.google.com/compute/docs/ip-addresses',
    assetType: 'compute.googleapis.com/Address',
  },
  {
    type: 'vpn-gateway',
    configKey: 'vpn',
    provider: 'gcp-vpn',
    docsUrl: 'https://cloud.google.com/network-connectivity/docs/vpn/concepts/overview',
    assetType: 'compute.googleapis.com/VpnGateway',
  },
  {
    type: 'vpn-tunnel',
    configKey: 'vpn',
    provider: 'gcp-vpn',
    docsUrl: 'https://cloud.google.com/network-connectivity/docs/vpn/concepts/tunnel',
    assetType: 'compute.googleapis.com/VpnTunnel',
  },
  {
    type: 'vpc-connector',
    configKey: 'vpcconnectors',
    provider: 'gcp-vpcconnectors',
    docsUrl: 'https://cloud.google.com/vpc/docs/serverless-vpc-access',
    assetType: 'vpcaccess.googleapis.com/Connector',
  },

  // Load balancing and the network edge.
  {
    type: 'load-balancer',
    configKey: 'loadbalancers',
    provider: 'gcp-loadbalancers',
    docsUrl: 'https://cloud.google.com/load-balancing/docs/forwarding-rule-concepts',
    assetType: 'compute.googleapis.com/ForwardingRule',
  },
  {
    type: 'url-map',
    configKey: 'loadbalancers',
    provider: 'gcp-loadbalancers',
    docsUrl: 'https://cloud.google.com/load-balancing/docs/url-map-concepts',
    assetType: 'compute.googleapis.com/UrlMap',
  },
  {
    type: 'backend-service',
    configKey: 'loadbalancers',
    provider: 'gcp-loadbalancers',
    docsUrl: 'https://cloud.google.com/load-balancing/docs/backend-service',
    assetType: 'compute.googleapis.com/BackendService',
  },
  {
    type: 'ssl-certificate',
    configKey: 'sslcertificates',
    provider: 'gcp-sslcertificates',
    docsUrl: 'https://cloud.google.com/load-balancing/docs/ssl-certificates',
    assetType: 'compute.googleapis.com/SslCertificate',
  },
  {
    type: 'security-policy',
    configKey: 'armor',
    provider: 'gcp-armor',
    docsUrl: 'https://cloud.google.com/armor/docs/security-policy-overview',
    assetType: 'compute.googleapis.com/SecurityPolicy',
  },

  // Databases.
  {
    type: 'cloudsql-instance',
    configKey: 'cloudsql',
    provider: 'gcp-cloudsql',
    docsUrl: 'https://cloud.google.com/sql/docs/mysql/instance-settings',
    assetType: 'sqladmin.googleapis.com/Instance',
    // The API is `sqladmin`, the assets are named under `cloudsql`.
    assetHost: 'cloudsql.googleapis.com',
  },
  {
    type: 'spanner-instance',
    configKey: 'spanner',
    provider: 'gcp-spanner',
    docsUrl: 'https://cloud.google.com/spanner/docs/instances',
    assetType: 'spanner.googleapis.com/Instance',
  },
  {
    type: 'spanner-database',
    configKey: 'spanner',
    provider: 'gcp-spanner',
    docsUrl: 'https://cloud.google.com/spanner/docs/schema-and-data-model',
    assetType: 'spanner.googleapis.com/Database',
  },
  {
    type: 'redis-instance',
    configKey: 'redis',
    provider: 'gcp-redis',
    docsUrl: 'https://cloud.google.com/memorystore/docs/redis',
    assetType: 'redis.googleapis.com/Instance',
  },
  {
    type: 'memcache-instance',
    configKey: 'memcache',
    provider: 'gcp-memcache',
    docsUrl: 'https://cloud.google.com/memorystore/docs/memcached',
    assetType: 'memcache.googleapis.com/Instance',
  },
  {
    type: 'alloydb-cluster',
    configKey: 'alloydb',
    provider: 'gcp-alloydb',
    docsUrl: 'https://cloud.google.com/alloydb/docs/cluster-overview',
    assetType: 'alloydb.googleapis.com/Cluster',
  },
  {
    type: 'alloydb-instance',
    configKey: 'alloydb',
    provider: 'gcp-alloydb',
    docsUrl: 'https://cloud.google.com/alloydb/docs/instance-overview',
    assetType: 'alloydb.googleapis.com/Instance',
  },
  {
    type: 'bigtable-instance',
    configKey: 'bigtable',
    provider: 'gcp-bigtable',
    docsUrl: 'https://cloud.google.com/bigtable/docs/instances-clusters-nodes',
    assetType: 'bigtableadmin.googleapis.com/Instance',
  },
  {
    type: 'firestore-database',
    configKey: 'firestore',
    provider: 'gcp-firestore',
    docsUrl: 'https://cloud.google.com/firestore/docs',
    assetType: 'firestore.googleapis.com/Database',
  },
  {
    type: 'filestore-instance',
    configKey: 'filestore',
    provider: 'gcp-filestore',
    docsUrl: 'https://cloud.google.com/filestore/docs/overview',
    assetType: 'file.googleapis.com/Instance',
  },

  // Messaging and eventing.
  {
    type: 'kafka-cluster',
    configKey: 'managedkafka',
    provider: 'gcp-managedkafka',
    docsUrl: 'https://cloud.google.com/managed-service-for-apache-kafka/docs/create-cluster',
    assetType: 'managedkafka.googleapis.com/Cluster',
  },
  {
    type: 'kafka-topic',
    configKey: 'managedkafka',
    provider: 'gcp-managedkafka',
    docsUrl: 'https://cloud.google.com/managed-service-for-apache-kafka/docs/create-topic',
    assetType: 'managedkafka.googleapis.com/Topic',
  },
  {
    type: 'eventarc-trigger',
    configKey: 'eventarc',
    provider: 'gcp-eventarc',
    docsUrl: 'https://cloud.google.com/eventarc/docs/overview',
    assetType: 'eventarc.googleapis.com/Trigger',
  },
  {
    type: 'cloud-tasks-queue',
    configKey: 'cloudtasks',
    provider: 'gcp-cloudtasks',
    docsUrl: 'https://cloud.google.com/tasks/docs/dual-overview',
    assetType: 'cloudtasks.googleapis.com/Queue',
  },
  {
    type: 'scheduler-job',
    configKey: 'scheduler',
    provider: 'gcp-scheduler',
    docsUrl: 'https://cloud.google.com/scheduler/docs',
    assetType: 'cloudscheduler.googleapis.com/Job',
  },

  // Serverless and artifacts.
  {
    type: 'cloud-run-service',
    configKey: 'run',
    provider: 'gcp-run',
    docsUrl: 'https://cloud.google.com/run/docs/deploying',
    assetType: 'run.googleapis.com/Service',
  },
  {
    type: 'cloud-run-job',
    configKey: 'run',
    provider: 'gcp-run',
    docsUrl: 'https://cloud.google.com/run/docs/create-jobs',
    assetType: 'run.googleapis.com/Job',
  },
  {
    type: 'cloud-function',
    configKey: 'functions',
    provider: 'gcp-functions',
    docsUrl: 'https://cloud.google.com/functions/docs/concepts/overview',
    assetType: 'cloudfunctions.googleapis.com/CloudFunction',
  },
  {
    type: 'artifact-repository',
    configKey: 'artifactregistry',
    provider: 'gcp-artifactregistry',
    docsUrl: 'https://cloud.google.com/artifact-registry/docs/repositories',
    assetType: 'artifactregistry.googleapis.com/Repository',
  },
  {
    type: 'workflow',
    configKey: 'workflows',
    provider: 'gcp-workflows',
    docsUrl: 'https://cloud.google.com/workflows/docs/overview',
    assetType: 'workflows.googleapis.com/Workflow',
  },

  // CI/CD.
  {
    type: 'build-trigger',
    configKey: 'cloudbuild',
    provider: 'gcp-cloudbuild',
    docsUrl: 'https://cloud.google.com/build/docs/automating-builds/create-manage-triggers',
    assetType: 'cloudbuild.googleapis.com/BuildTrigger',
  },
  {
    type: 'delivery-pipeline',
    configKey: 'clouddeploy',
    provider: 'gcp-clouddeploy',
    docsUrl: 'https://cloud.google.com/deploy/docs/overview',
    assetType: 'clouddeploy.googleapis.com/DeliveryPipeline',
  },
  {
    type: 'deploy-target',
    configKey: 'clouddeploy',
    provider: 'gcp-clouddeploy',
    docsUrl: 'https://cloud.google.com/deploy/docs/deploy-app-gke',
    assetType: 'clouddeploy.googleapis.com/Target',
  },

  // Security and keys.
  {
    type: 'kms-key-ring',
    configKey: 'kms',
    provider: 'gcp-kms',
    docsUrl: 'https://cloud.google.com/kms/docs/resource-hierarchy#key_rings',
    assetType: 'cloudkms.googleapis.com/KeyRing',
  },
  {
    type: 'kms-key',
    configKey: 'kms',
    provider: 'gcp-kms',
    docsUrl: 'https://cloud.google.com/kms/docs/resource-hierarchy#keys',
    assetType: 'cloudkms.googleapis.com/CryptoKey',
  },
  {
    type: 'certificate',
    configKey: 'certificatemanager',
    provider: 'gcp-certificatemanager',
    docsUrl: 'https://cloud.google.com/certificate-manager/docs/certificates',
    assetType: 'certificatemanager.googleapis.com/Certificate',
  },
  {
    type: 'certificate-map',
    configKey: 'certificatemanager',
    provider: 'gcp-certificatemanager',
    docsUrl: 'https://cloud.google.com/certificate-manager/docs/maps',
    assetType: 'certificatemanager.googleapis.com/CertificateMap',
  },
  {
    type: 'binauthz-policy',
    configKey: 'binaryauthorization',
    provider: 'gcp-binaryauthorization',
    docsUrl: 'https://cloud.google.com/binary-authorization/docs/policy-yaml-reference',
    // The policy is a project singleton rather than a named resource, so it holds no policy of
    // its own that a binding could name.
  },
  {
    type: 'binauthz-attestor',
    configKey: 'binaryauthorization',
    provider: 'gcp-binaryauthorization',
    docsUrl: 'https://cloud.google.com/binary-authorization/docs/creating-attestors-cli',
    assetType: 'binaryauthorization.googleapis.com/Attestor',
  },

  // Observability.
  {
    type: 'alert-policy',
    configKey: 'alerts',
    provider: 'gcp-alerts',
    docsUrl: 'https://cloud.google.com/monitoring/alerts',
    assetType: 'monitoring.googleapis.com/AlertPolicy',
  },
  {
    type: 'uptime-check',
    configKey: 'alerts',
    provider: 'gcp-alerts',
    docsUrl: 'https://cloud.google.com/monitoring/uptime-checks',
    assetType: 'monitoring.googleapis.com/UptimeCheckConfig',
  },
  {
    type: 'monitoring-service',
    configKey: 'slos',
    provider: 'gcp-slos',
    docsUrl: 'https://cloud.google.com/stackdriver/docs/solutions/slo-monitoring',
    assetType: 'monitoring.googleapis.com/Service',
  },
  {
    type: 'slo',
    configKey: 'slos',
    provider: 'gcp-slos',
    docsUrl: 'https://cloud.google.com/stackdriver/docs/solutions/slo-monitoring/api/concepts',
    assetType: 'monitoring.googleapis.com/ServiceLevelObjective',
  },
  {
    type: 'log-sink',
    configKey: 'logsinks',
    provider: 'gcp-logsinks',
    docsUrl: 'https://cloud.google.com/logging/docs/export/configure_export_v2',
    assetType: 'logging.googleapis.com/LogSink',
  },

  // Data platform.
  {
    type: 'bigquery-transfer',
    configKey: 'bqtransfers',
    provider: 'gcp-bqtransfers',
    docsUrl: 'https://cloud.google.com/bigquery/docs/dts-introduction',
    assetType: 'bigquerydatatransfer.googleapis.com/TransferConfig',
  },
  {
    type: 'bigquery-reservation',
    configKey: 'bqreservations',
    provider: 'gcp-bqreservations',
    docsUrl: 'https://cloud.google.com/bigquery/docs/reservations-intro',
    assetType: 'bigqueryreservation.googleapis.com/Reservation',
  },
  {
    type: 'analytics-hub-exchange',
    configKey: 'analyticshub',
    provider: 'gcp-analyticshub',
    docsUrl: 'https://cloud.google.com/bigquery/docs/analytics-hub-introduction',
    assetType: 'analyticshub.googleapis.com/DataExchange',
  },
  {
    type: 'analytics-hub-listing',
    configKey: 'analyticshub',
    provider: 'gcp-analyticshub',
    docsUrl: 'https://cloud.google.com/bigquery/docs/analytics-hub-manage-listings',
    assetType: 'analyticshub.googleapis.com/Listing',
  },
  {
    type: 'datastream-stream',
    configKey: 'datastream',
    provider: 'gcp-datastream',
    docsUrl: 'https://cloud.google.com/datastream/docs/overview',
    assetType: 'datastream.googleapis.com/Stream',
  },
  {
    type: 'dataplex-lake',
    configKey: 'dataplex',
    provider: 'gcp-dataplex',
    docsUrl: 'https://cloud.google.com/dataplex/docs/introduction',
    assetType: 'dataplex.googleapis.com/Lake',
  },
  {
    type: 'dataflow-job',
    configKey: 'dataflow',
    provider: 'gcp-dataflow',
    docsUrl: 'https://cloud.google.com/dataflow/docs/concepts/beam-programming-model',
    // A Dataflow job is one execution rather than a resource with a lifecycle, and carries no IAM
    // policy of its own — access is granted on the project.
  },
  {
    type: 'dataproc-cluster',
    configKey: 'dataproc',
    provider: 'gcp-dataproc',
    docsUrl: 'https://cloud.google.com/dataproc/docs/concepts/overview',
    assetType: 'dataproc.googleapis.com/Cluster',
  },
  {
    type: 'composer-environment',
    configKey: 'composer',
    provider: 'gcp-composer',
    docsUrl: 'https://cloud.google.com/composer/docs/concepts/overview',
    assetType: 'composer.googleapis.com/Environment',
  },

  // Vertex AI and ML.
  {
    type: 'vertex-endpoint',
    configKey: 'vertex',
    provider: 'gcp-vertex',
    docsUrl: 'https://cloud.google.com/vertex-ai/docs/predictions/overview',
    assetType: 'aiplatform.googleapis.com/Endpoint',
  },
  {
    type: 'vertex-model',
    configKey: 'vertex',
    provider: 'gcp-vertex',
    docsUrl: 'https://cloud.google.com/vertex-ai/docs/model-registry/introduction',
    assetType: 'aiplatform.googleapis.com/Model',
  },
  {
    type: 'workbench-instance',
    configKey: 'workbench',
    provider: 'gcp-workbench',
    docsUrl: 'https://cloud.google.com/vertex-ai/docs/workbench/introduction',
    assetType: 'notebooks.googleapis.com/Instance',
  },
];

/** Every config key that owns at least one resource type. */
export const RESOURCE_CONFIG_KEYS: string[] = [...new Set(RESOURCE_TYPES.map(resource => resource.configKey))];

/**
 * The config key of the provider that owns a `spec.type`.
 *
 * Lets anything holding an entity rather than a provider — the relation processor above all — read
 * that provider's own settings, so a per-provider option cannot mean one thing on the way in and
 * another on the way out.
 */
export const CONFIG_KEY_BY_TYPE: ReadonlyMap<string, string> = new Map(
  RESOURCE_TYPES.map(resource => [resource.type, resource.configKey]),
);

/**
 * The Cloud Asset Inventory host a `spec.type` is named under, for the types that carry a policy.
 *
 * Lets an entity's asset name be derived rather than spelled out by each provider — see
 * `GcpRestEntityProvider.assetNameOf`.
 */
export const ASSET_HOST_BY_TYPE: ReadonlyMap<string, string> = new Map(
  RESOURCE_TYPES.filter(resource => resource.assetType).map(resource => [
    resource.type,
    resource.assetHost ?? (resource.assetType as string).split('/')[0],
  ]),
);
