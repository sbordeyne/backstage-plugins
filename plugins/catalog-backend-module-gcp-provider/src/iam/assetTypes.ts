import { lastSegment, segmentAfter } from '../utils';

/**
 * How an asset type reported by Cloud Asset Inventory maps onto an entity this module ingests.
 *
 * The registry is what makes an IAM binding addressable: a policy names its resource as
 * `//storage.googleapis.com/projects/_/buckets/reports`, and a relation needs
 * `resource:<namespace>/reports` — which takes knowing the provider that ingests buckets, so its
 * namespace template can be applied.
 */
export interface AssetTypeMapping {
  /** Config key of the provider ingesting this asset type, for its namespace template. */
  configKey: string;
  /** Provider name, available to that template as `${provider}`. */
  provider: string;
  /** `spec.type` of the resulting entity, available as `${type}`. */
  type: string;
  /**
   * How the entity name is derived, when the leaf of the asset name is not it. Subnets carry their
   * region, Pub/Sub topics have prefixes stripped, and both are handled by the caller rather than
   * here, since they need provider configuration.
   */
  nameStyle?: 'subnet' | 'pubsub' | 'serviceAccount';
}

/**
 * One entry per ingested resource type. An asset type absent from here yields no relation, which is
 * the right outcome: pointing at an entity that is not ingested would dangle.
 */
export const ASSET_TYPES: Record<string, AssetTypeMapping> = {
  'storage.googleapis.com/Bucket': { configKey: 'storage', provider: 'gcp-bucket', type: 'bucket' },
  'bigquery.googleapis.com/Dataset': {
    configKey: 'bigquery',
    provider: 'gcp-bigquery',
    type: 'bigquery-dataset',
  },
  'sqladmin.googleapis.com/Instance': {
    configKey: 'cloudsql',
    provider: 'gcp-cloudsql',
    type: 'cloudsql-instance',
  },
  'pubsub.googleapis.com/Topic': {
    configKey: 'pubsub',
    provider: 'gcp-pubsub',
    type: 'pubsub-topic',
    nameStyle: 'pubsub',
  },
  'pubsub.googleapis.com/Subscription': {
    configKey: 'pubsub',
    provider: 'gcp-pubsub',
    type: 'pubsub-subscription',
    nameStyle: 'pubsub',
  },
  'secretmanager.googleapis.com/Secret': {
    configKey: 'secretmanager',
    provider: 'gcp-secret-manager',
    type: 'secret',
  },
  'iam.googleapis.com/ServiceAccount': {
    configKey: 'service-account',
    provider: 'gcp-service-account',
    type: 'google-service-account',
    nameStyle: 'serviceAccount',
  },
  'container.googleapis.com/Cluster': {
    configKey: 'clusters',
    provider: 'gcp-clusters',
    type: 'kubernetes-cluster',
  },
  'compute.googleapis.com/Network': { configKey: 'vpc', provider: 'gcp-vpc', type: 'vpc-network' },
  'compute.googleapis.com/Subnetwork': {
    configKey: 'subnets',
    provider: 'gcp-subnets',
    type: 'subnetwork',
    nameStyle: 'subnet',
  },
  'compute.googleapis.com/Firewall': { configKey: 'firewall', provider: 'gcp-firewall', type: 'firewall-rule' },
  'compute.googleapis.com/Router': { configKey: 'routers', provider: 'gcp-routers', type: 'cloud-router' },
  'dns.googleapis.com/ManagedZone': { configKey: 'dns', provider: 'gcp-dns', type: 'dns-zone' },
  'compute.googleapis.com/Instance': {
    configKey: 'instances',
    provider: 'gcp-instances',
    type: 'compute-instance',
  },
  'compute.googleapis.com/InstanceGroupManager': {
    configKey: 'instance-groups',
    provider: 'gcp-instance-groups',
    type: 'instance-group',
  },
  'compute.googleapis.com/Image': { configKey: 'images', provider: 'gcp-images', type: 'compute-image' },
  'spanner.googleapis.com/Instance': { configKey: 'spanner', provider: 'gcp-spanner', type: 'spanner-instance' },
  'redis.googleapis.com/Instance': { configKey: 'redis', provider: 'gcp-redis', type: 'redis-instance' },
  'alloydb.googleapis.com/Cluster': { configKey: 'alloydb', provider: 'gcp-alloydb', type: 'alloydb-cluster' },
  'bigtableadmin.googleapis.com/Instance': {
    configKey: 'bigtable',
    provider: 'gcp-bigtable',
    type: 'bigtable-instance',
  },
  'firestore.googleapis.com/Database': {
    configKey: 'firestore',
    provider: 'gcp-firestore',
    type: 'firestore-database',
  },
  'managedkafka.googleapis.com/Cluster': {
    configKey: 'managedkafka',
    provider: 'gcp-managedkafka',
    type: 'kafka-cluster',
  },
  'eventarc.googleapis.com/Trigger': {
    configKey: 'eventarc',
    provider: 'gcp-eventarc',
    type: 'eventarc-trigger',
  },
  'cloudtasks.googleapis.com/Queue': {
    configKey: 'cloudtasks',
    provider: 'gcp-cloudtasks',
    type: 'cloud-tasks-queue',
  },
  'cloudscheduler.googleapis.com/Job': {
    configKey: 'scheduler',
    provider: 'gcp-scheduler',
    type: 'scheduler-job',
  },
  'run.googleapis.com/Service': { configKey: 'run', provider: 'gcp-run', type: 'cloud-run-service' },
  'run.googleapis.com/Job': { configKey: 'run', provider: 'gcp-run', type: 'cloud-run-job' },
  'cloudfunctions.googleapis.com/CloudFunction': {
    configKey: 'functions',
    provider: 'gcp-functions',
    type: 'cloud-function',
  },
  'artifactregistry.googleapis.com/Repository': {
    configKey: 'artifactregistry',
    provider: 'gcp-artifactregistry',
    type: 'artifact-repository',
  },
};

/** What an asset name says about the resource behind it, before entity naming is applied. */
export interface ParsedAsset {
  mapping: AssetTypeMapping;
  /** Project the resource lives in, from the asset name. */
  projectId?: string;
  /** Region, zone or location, when the asset name carries one. */
  region?: string;
  /** The leaf of the asset name, e.g. `reports` for a bucket. */
  leaf: string;
}

/**
 * An asset name and type read as the resource they describe, or undefined when nothing ingests that
 * type.
 *
 * Names look like `//service.googleapis.com/projects/p/locations/l/kind/name`, with a few older
 * services using `projects/_/…` for resources whose names are globally unique.
 */
export function parseAsset(assetName: string, assetType: string): ParsedAsset | undefined {
  const mapping = ASSET_TYPES[assetType];
  if (!mapping) {
    return undefined;
  }
  const path = assetName.replace(/^\/\//, '');
  const projectId = segmentAfter(path, 'projects');
  return {
    mapping,
    // `projects/_` means the service does not scope the name by project.
    projectId: projectId && projectId !== '_' ? projectId : undefined,
    region: segmentAfter(path, 'locations') ?? segmentAfter(path, 'regions') ?? segmentAfter(path, 'zones'),
    leaf: lastSegment(path),
  };
}
