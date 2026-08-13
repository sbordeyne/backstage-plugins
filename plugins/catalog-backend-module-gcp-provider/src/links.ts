import { EntityLink } from '@backstage/catalog-model';
import { GCP_CONSOLE_URL } from './constants';

/**
 * Which families of links are written onto an entity.
 *
 * Console and documentation links are on by default: they are short, stable and the first thing
 * someone opening a catalog entry wants. The Logs Explorer link is off by default because its query
 * is a guess about how the resource logs, and a wrong filter is worse than no link.
 */
export interface LinkOptions {
  console: boolean;
  docs: boolean;
  logs: boolean;
}

export const DEFAULT_LINK_OPTIONS: LinkOptions = {
  console: true,
  docs: true,
  logs: false,
};

/**
 * Product documentation per `spec.type`.
 *
 * Keyed by type rather than by provider so two resource types ingested by one provider — a Spanner
 * instance and a Spanner database, say — can point at different pages.
 */
export const DOCS_URLS: Record<string, string> = {
  // Ingested since the first version of the module.
  'bigquery-dataset': 'https://cloud.google.com/bigquery/docs/datasets-intro',
  bucket: 'https://cloud.google.com/storage/docs/buckets',
  'cloudsql-instance': 'https://cloud.google.com/sql/docs/mysql/instance-settings',
  'pubsub-topic': 'https://cloud.google.com/pubsub/docs/overview',
  'pubsub-subscription': 'https://cloud.google.com/pubsub/docs/subscriber',
  secret: 'https://cloud.google.com/secret-manager/docs',
  'google-service-account': 'https://cloud.google.com/iam/docs/service-account-overview',
  'kubernetes-cluster': 'https://cloud.google.com/kubernetes-engine/docs',

  // Networking and compute.
  'vpc-network': 'https://cloud.google.com/vpc/docs/vpc',
  subnetwork: 'https://cloud.google.com/vpc/docs/subnets',
  'firewall-rule': 'https://cloud.google.com/firewall/docs/firewalls',
  'cloud-router': 'https://cloud.google.com/network-connectivity/docs/router/concepts/overview',
  'cloud-nat': 'https://cloud.google.com/nat/docs/overview',
  'dns-zone': 'https://cloud.google.com/dns/docs/zones',
  'compute-instance': 'https://cloud.google.com/compute/docs/instances',
  'instance-group': 'https://cloud.google.com/compute/docs/instance-groups',
  'compute-image': 'https://cloud.google.com/compute/docs/images',

  // Databases.
  'spanner-instance': 'https://cloud.google.com/spanner/docs/instances',
  'spanner-database': 'https://cloud.google.com/spanner/docs/schema-and-data-model',
  'redis-instance': 'https://cloud.google.com/memorystore/docs/redis',
  'alloydb-cluster': 'https://cloud.google.com/alloydb/docs/cluster-overview',
  'alloydb-instance': 'https://cloud.google.com/alloydb/docs/instance-overview',
  'bigtable-instance': 'https://cloud.google.com/bigtable/docs/instances-clusters-nodes',
  'firestore-database': 'https://cloud.google.com/firestore/docs',

  // Messaging and eventing.
  'kafka-cluster': 'https://cloud.google.com/managed-service-for-apache-kafka/docs/create-cluster',
  'kafka-topic': 'https://cloud.google.com/managed-service-for-apache-kafka/docs/create-topic',
  'cloud-tasks-queue': 'https://cloud.google.com/tasks/docs/dual-overview',
  'eventarc-trigger': 'https://cloud.google.com/eventarc/docs/overview',
  'scheduler-job': 'https://cloud.google.com/scheduler/docs',

  // Serverless and artifacts.
  'cloud-run-service': 'https://cloud.google.com/run/docs/deploying',
  'cloud-run-job': 'https://cloud.google.com/run/docs/create-jobs',
  'cloud-function': 'https://cloud.google.com/functions/docs/concepts/overview',
  'artifact-repository': 'https://cloud.google.com/artifact-registry/docs/repositories',
};

/**
 * A console URL for a path such as `sql/instances/my-db/overview`.
 *
 * The project is a query parameter rather than part of the path everywhere in the console, and a
 * few paths carry query parameters of their own, so it is appended with whichever separator fits.
 */
export function consoleUrl(consolePath: string, projectId: string): string {
  const path = consolePath.replace(/^\//, '');
  const separator = path.includes('?') ? '&' : '?';
  return `${GCP_CONSOLE_URL}/${path}${separator}project=${encodeURIComponent(projectId)}`;
}

/**
 * A Logs Explorer URL for a filter such as `resource.type="gce_instance"`.
 *
 * The query lives in a path segment rather than the query string, which is why it is encoded and
 * appended before the `?project=`.
 */
export function logsUrl(filter: string, projectId: string): string {
  return `${GCP_CONSOLE_URL}/logs/query;query=${encodeURIComponent(filter)}?project=${encodeURIComponent(projectId)}`;
}

/** Where a link came from, so an entity page can group them. */
export const LINK_TYPE_CONSOLE = 'console';
export const LINK_TYPE_DOCS = 'documentation';
export const LINK_TYPE_LOGS = 'logs';
export const LINK_TYPE_WEBSITE = 'website';

/**
 * The links for one resource, in the order they are worth reading: the console first, then the
 * resource's own extras, then documentation and logs.
 *
 * Duplicate URLs are dropped, so a provider that adds a link the shared builder would also produce
 * does not end up with it twice.
 */
export function buildLinks(options: {
  links: LinkOptions;
  projectId: string;
  type: string;
  consolePath?: string;
  docsUrl?: string;
  logFilter?: string;
  extra?: EntityLink[];
}): EntityLink[] {
  const built: EntityLink[] = [];

  if (options.links.console && options.consolePath) {
    built.push({
      url: consoleUrl(options.consolePath, options.projectId),
      title: 'Open in GCP console',
      icon: 'dashboard',
      type: LINK_TYPE_CONSOLE,
    });
  }

  built.push(...(options.extra ?? []));

  if (options.links.docs) {
    const docs = options.docsUrl ?? DOCS_URLS[options.type];
    if (docs) {
      built.push({ url: docs, title: 'Documentation', icon: 'docs', type: LINK_TYPE_DOCS });
    }
  }

  if (options.links.logs && options.logFilter) {
    built.push({
      url: logsUrl(options.logFilter, options.projectId),
      title: 'Logs',
      icon: 'alert',
      type: LINK_TYPE_LOGS,
    });
  }

  const seen = new Set<string>();
  return built.filter(link => {
    if (!link.url || seen.has(link.url)) {
      return false;
    }
    seen.add(link.url);
    return true;
  });
}
