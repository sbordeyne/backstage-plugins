import {
  SchedulerServiceTaskScheduleDefinition,
  readSchedulerServiceTaskScheduleDefinitionFromConfig,
} from '@backstage/backend-plugin-api';
import type { Config } from '@backstage/config';

const CONFIG_ROOT = 'kubespec';

/**
 * The timeout is deliberately modest, and has to stay comfortably above
 * `sync.maxTickDurationMinutes`.
 *
 * Backstage's scheduler never extends a running task's ticket, and only its
 * janitor clears an expired one, so the timeout doubles as the window in which an
 * abandoned ticket — from a crashed pod, a rolling deploy, a dev server reloading
 * — blocks every manual sync. A timeout sized for a whole cold ingest would mean
 * hours of `409 Conflict`. The tick stops itself on time instead, and the
 * remaining work resumes on the next one.
 */
const DEFAULT_SCHEDULE: SchedulerServiceTaskScheduleDefinition = {
  initialDelay: { minutes: 2 },
  frequency: { hours: 24 },
  timeout: { minutes: 20 },
};

export const KUBERNETES_SLUG = 'kubernetes';

/**
 * The default Kubernetes category map, ported from kubespec.dev. Config replaces
 * it wholesale rather than merging, so an operator who wants one extra kind
 * copies this and edits it — merging would make "why is this kind here?"
 * unanswerable from the config alone.
 */
export const DEFAULT_KUBERNETES_CATEGORIES: Record<string, string[]> = {
  Workloads: ['Pod', 'Deployment', 'DaemonSet', 'StatefulSet', 'Job', 'CronJob', 'ReplicaSet', 'ReplicationController'],
  Cluster: ['Node', 'Event', 'Namespace'],
  Networking: ['Service', 'Ingress', 'Endpoint', 'Endpoints', 'NetworkPolicy', 'EndpointSlice', 'IngressClass'],
  Configuration: [
    'ConfigMap',
    'LimitRange',
    'Secret',
    'Lease',
    'ResourceQuota',
    'HorizontalPodAutoscaler',
    'PodDisruptionBudget',
  ],
  Storage: [
    'CSINode',
    'CSIDriver',
    'CSIStorageCapacity',
    'StorageClass',
    'VolumeAttachment',
    'PersistentVolume',
    'PersistentVolumeClaim',
  ],
  Administration: [
    'MutatingWebhookConfiguration',
    'MutatingAdmissionPolicy',
    'MutatingAdmissionPolicyBinding',
    'ValidatingWebhookConfiguration',
    'ValidatingAdmissionPolicy',
    'ValidatingAdmissionPolicyBinding',
    'CustomResourceDefinition',
    'RuntimeClass',
    'PriorityClass',
    'ResourceClass',
  ],
  'Access Control': ['ServiceAccount', 'Role', 'RoleBinding', 'ClusterRole', 'ClusterRoleBinding'],
};

const DEFAULT_CATEGORY_ORDER = [
  'Workloads',
  'Cluster',
  'Networking',
  'Configuration',
  'Storage',
  'Administration',
  'Access Control',
];

export interface TagRules {
  prefix?: string;
  regex?: string;
  exclude?: string;
  minVersion?: string;
  maxVersion?: string;
  excludePrerelease: boolean;
  max: number;
}

export interface ProjectSourceConfig {
  slug: string;
  name: string;
  repo: string;
  logoUrl?: string;
  paths: string[];
  pathsMode: 'first' | 'all';
  releaseAsset?: string;
  order: number;
  tags: TagRules;
}

export interface KubernetesSourceConfig {
  slug: string;
  name: string;
  repo: string;
  logoUrl?: string;
  specPath: string;
  minors: string[];
  refTemplate: string;
  /** Kind -> category, inverted from the config's category -> kinds. */
  categoryByKind: Record<string, string>;
  defaultCategory: string;
  categoryOrder: string[];
}

export interface KubespecConfig {
  metadataDir?: string;
  pruneUnknownSources: boolean;
  search: {
    scope: 'latest' | 'all';
    maxDepth: number;
    maxResults: number;
  };
  sync: {
    enabled: boolean;
    concurrency: number;
    fileConcurrency: number;
    maxVersionsPerTick: number;
    maxTickDurationMs: number;
    maxSpecBytes: number;
    maxResourceNodes: number;
    maxResourceDepth: number;
    schedule: SchedulerServiceTaskScheduleDefinition;
  };
  /** Absent when the core Kubernetes source is disabled or has no pinned minors. */
  kubernetes?: KubernetesSourceConfig;
  projects: ProjectSourceConfig[];
}

export function readKubespecConfig(rootConfig: Config): KubespecConfig {
  const config = rootConfig.getOptionalConfig(CONFIG_ROOT);

  return {
    metadataDir: config?.getOptionalString('metadataDir'),
    pruneUnknownSources: config?.getOptionalBoolean('pruneUnknownSources') ?? true,
    search: {
      scope: readSearchScope(config),
      maxDepth: config?.getOptionalNumber('search.maxDepth') ?? 6,
      maxResults: config?.getOptionalNumber('search.maxResults') ?? 50,
    },
    sync: {
      enabled: config?.getOptionalBoolean('sync.enabled') ?? true,
      concurrency: config?.getOptionalNumber('sync.concurrency') ?? 4,
      fileConcurrency: config?.getOptionalNumber('sync.fileConcurrency') ?? 8,
      maxVersionsPerTick: config?.getOptionalNumber('sync.maxVersionsPerTick') ?? 60,
      maxTickDurationMs: (config?.getOptionalNumber('sync.maxTickDurationMinutes') ?? 10) * 60_000,
      maxSpecBytes: config?.getOptionalNumber('sync.maxSpecBytes') ?? 64 * 1024 * 1024,
      maxResourceNodes: config?.getOptionalNumber('sync.maxResourceNodes') ?? 50_000,
      maxResourceDepth: config?.getOptionalNumber('sync.maxResourceDepth') ?? 20,
      schedule: readSchedule(config),
    },
    kubernetes: readKubernetes(config),
    projects: readProjects(config),
  };
}

function readSearchScope(config?: Config): 'latest' | 'all' {
  const scope = config?.getOptionalString('search.scope') ?? 'latest';
  if (scope !== 'latest' && scope !== 'all') {
    throw new Error(`kubespec.search.scope must be 'latest' or 'all', got '${scope}'`);
  }
  return scope;
}

function readSchedule(config?: Config): SchedulerServiceTaskScheduleDefinition {
  // readSchedulerServiceTaskScheduleDefinitionFromConfig throws on a missing
  // config object, so the presence check has to come first.
  if (!config?.has('sync.schedule')) {
    return DEFAULT_SCHEDULE;
  }
  return readSchedulerServiceTaskScheduleDefinitionFromConfig(config.getConfig('sync.schedule'));
}

function readKubernetes(config?: Config): KubernetesSourceConfig | undefined {
  const kubernetes = config?.getOptionalConfig('kubernetes');
  if (kubernetes?.getOptionalBoolean('enabled') === false) {
    return undefined;
  }

  const minors = kubernetes?.getOptionalStringArray('minors') ?? [];
  if (minors.length === 0) {
    // Without pinned minors there is nothing to fetch: the whole point of the
    // pinned list is that we never guess which Kubernetes versions matter here.
    return undefined;
  }

  const categories = kubernetes?.getOptional<Record<string, string[]>>('categories');

  return {
    slug: KUBERNETES_SLUG,
    name: kubernetes?.getOptionalString('name') ?? 'Kubernetes',
    repo: kubernetes?.getOptionalString('repo') ?? 'kubernetes/kubernetes',
    logoUrl: kubernetes?.getOptionalString('logoUrl'),
    specPath: kubernetes?.getOptionalString('specPath') ?? 'api/openapi-spec/swagger.json',
    minors,
    refTemplate: kubernetes?.getOptionalString('refTemplate') ?? '{minor}.0',
    categoryByKind: invertCategories(categories ?? DEFAULT_KUBERNETES_CATEGORIES),
    defaultCategory: kubernetes?.getOptionalString('defaultCategory') ?? 'Other',
    categoryOrder:
      kubernetes?.getOptionalStringArray('categoryOrder') ??
      (categories ? Object.keys(categories) : DEFAULT_CATEGORY_ORDER),
  };
}

function invertCategories(categories: Record<string, string[]>): Record<string, string> {
  const byKind: Record<string, string> = {};
  for (const [category, kinds] of Object.entries(categories)) {
    for (const kind of kinds) {
      byKind[kind] = category;
    }
  }
  return byKind;
}

function readProjects(config?: Config): ProjectSourceConfig[] {
  const projects = config?.getOptionalConfigArray('projects') ?? [];

  return projects.map((project, index) => {
    const slug = project.getString('slug');
    if (slug === KUBERNETES_SLUG) {
      throw new Error(
        `kubespec.projects[${index}]: '${KUBERNETES_SLUG}' is reserved for the core API, configure it under kubespec.kubernetes`,
      );
    }
    // The frontend spells the core group as the literal path segment 'core', so a
    // source slug of 'core' would make a URL ambiguous.
    if (slug === 'core') {
      throw new Error(`kubespec.projects[${index}]: 'core' is a reserved slug`);
    }

    const paths = project.getOptionalStringArray('paths') ?? [];
    const releaseAsset = project.getOptionalString('releaseAsset');
    if (paths.length === 0 && !releaseAsset) {
      throw new Error(`kubespec.projects[${index}] ('${slug}'): one of 'paths' or 'releaseAsset' is required`);
    }

    return {
      slug,
      name: project.getString('name'),
      repo: project.getString('repo'),
      logoUrl: project.getOptionalString('logoUrl'),
      paths,
      pathsMode: readPathsMode(project, index, slug),
      releaseAsset,
      order: project.getOptionalNumber('order') ?? index,
      tags: readTagRules(project.getOptionalConfig('tags'), `kubespec.projects[${index}] ('${slug}')`),
    };
  });
}

function readPathsMode(project: Config, index: number, slug: string): 'first' | 'all' {
  const mode = project.getOptionalString('pathsMode') ?? 'first';
  if (mode !== 'first' && mode !== 'all') {
    throw new Error(`kubespec.projects[${index}] ('${slug}'): pathsMode must be 'first' or 'all', got '${mode}'`);
  }
  return mode;
}

function readTagRules(tags?: Config, context = 'kubespec'): TagRules {
  return {
    prefix: tags?.getOptionalString('prefix'),
    regex: validateRegex(tags?.getOptionalString('regex'), `${context}.tags.regex`),
    exclude: validateRegex(tags?.getOptionalString('exclude'), `${context}.tags.exclude`),
    minVersion: tags?.getOptionalString('minVersion'),
    maxVersion: tags?.getOptionalString('maxVersion'),
    excludePrerelease: tags?.getOptionalBoolean('excludePrerelease') ?? true,
    max: tags?.getOptionalNumber('max') ?? 10,
  };
}

/**
 * Compiled once at startup so a malformed pattern fails the backend with a clear
 * message, rather than silently matching nothing — or, worse, being dropped and
 * silently matching everything — once the sync worker is already running.
 */
function validateRegex(pattern: string | undefined, path: string): string | undefined {
  if (!pattern) {
    return undefined;
  }
  try {
    // eslint-disable-next-line no-new
    new RegExp(pattern);
  } catch (error) {
    throw new Error(`${path} is not a valid regular expression: ${(error as Error).message}`);
  }
  return pattern;
}
