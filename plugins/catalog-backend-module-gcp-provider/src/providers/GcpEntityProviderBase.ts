import { DeferredEntity, EntityProvider, EntityProviderConnection } from '@backstage/plugin-catalog-node';
import { Config } from '@backstage/config';
import {
  LoggerService,
  SchedulerService,
  SchedulerServiceTaskRunner,
  readSchedulerServiceTaskScheduleDefinitionFromConfig,
} from '@backstage/backend-plugin-api';
import { EntityLink } from '@backstage/catalog-model';
import { JWTInput } from 'google-auth-library';
import { google } from 'googleapis';

/**
 * The `GoogleAuth` the API clients accept.
 *
 * `googleapis-common` bundles its own copy of `google-auth-library`, and the two copies are
 * nominally different types, so the instance has to be typed from the `googleapis` surface rather
 * than imported from the library directly.
 */
export type GcpGoogleAuth = InstanceType<typeof google.auth.GoogleAuth>;
import fs from 'fs';
import {
  ANNOTATION_GCP_PROJECT_ID,
  DEFAULT_NAMESPACE_TEMPLATE,
  DEFAULT_OWNER_LABEL,
  DEFAULT_SYSTEM_LABEL,
} from '../constants';
import { buildLinks, DEFAULT_LINK_OPTIONS, LinkOptions } from '../links';
import { GcpAssetIndex, GcpAssetIndexOptions, GcpProjectPolicies, getAssetIndex, parseAsset } from '../iam';
import {
  formatResourceName,
  GcpLabels,
  GcpResourceContext,
  lastSegment,
  parseOwnerRef,
  parseResourceUrl,
  parseSystemRef,
  readLabel,
  regionAnnotation,
  renderTemplate,
  segmentAfter,
  selfLinkAnnotation,
  stripPrefixes,
  toEntityLabels,
  toEntityTags,
} from '../utils';

/** A resource as the provider knows it, before it is turned into entity metadata. */
export interface GcpResource {
  /** Name of the resource, normalized into an entity name by {@link formatResourceName}. */
  name: string;
  /** Project the resource lives in. */
  projectId: string;
  /** Value used as `spec.type`, and available to the namespace template. */
  type: string;
  /** Region or location, when the API reported one. Falls back to the configured default. */
  region?: string | null;
  /** Canonical GCP URL of the resource, annotated when there is one. */
  selfLink?: string | null;
  /** Labels as the GCP API reported them, copied onto the entity. */
  labels?: GcpLabels;
  /** Display title, when the API carries one distinct from the name. */
  title?: string | null;
  /** Description as the API reports it, used ahead of {@link summary}. */
  description?: string | null;
  /** One-liner describing the resource, used when the API carries no description of its own. */
  summary?: string;
  /** Console path for this resource, e.g. `sql/instances/my-db/overview`. */
  consolePath?: string;
  /** Documentation URL, when the resource needs one other than the default for its type. */
  docsUrl?: string;
  /** Logs Explorer filter matching this resource, e.g. `resource.type="gce_instance"`. */
  logFilter?: string;
  /** Links specific to this resource, such as the URL a Cloud Run service serves on. */
  links?: EntityLink[];
  /** Facts worth tagging when tags are enabled: state, engine version, machine type. */
  tagValues?: (string | null | undefined)[];
  /**
   * Cloud Asset Inventory name of this resource, e.g.
   * `//storage.googleapis.com/projects/_/buckets/reports`.
   *
   * Only needed for the opt-in `iam.annotateResources` annotation — the IAM *relations* are
   * declared on the service account and need nothing from the resource side.
   */
  assetName?: string;
  /** Annotations specific to this kind of resource, merged over the shared ones. */
  annotations?: Record<string, string>;
}

/** Which facts about a resource become catalog tags. All off unless configured. */
export interface TagOptions {
  /** Every GCP label as a `key-value` tag. */
  fromLabels: boolean;
  /** Values of these label keys as bare tags. */
  labelKeys: string[];
  /** The entity's `spec.type`. */
  resourceType: boolean;
  /** The resource's region. */
  region: boolean;
  /** The project the resource lives in. */
  project: boolean;
  /** The per-resource {@link GcpResource.tagValues}. */
  attributes: boolean;
}

const NO_TAGS: TagOptions = {
  fromLabels: false,
  labelKeys: [],
  resourceType: false,
  region: false,
  project: false,
  attributes: false,
};

/**
 * Catalog provider to ingest GKE clusters
 *
 * @public
 */
export abstract class GcpEntityProviderBase<TClient> implements EntityProvider {
  protected readonly logger: LoggerService;
  private readonly scheduleFn: () => Promise<void>;
  protected readonly config: Config;
  /** `catalog.providers.gcp`, holding the defaults shared by every provider. */
  protected readonly gcpConfig: Config;
  protected readonly client: TClient;
  private connection?: EntityProviderConnection;
  protected credentials?: JWTInput;
  /**
   * Credentials for the `googleapis` clients.
   *
   * `GoogleAuth` resolves a key file, `gcloud` application default credentials, Workload Identity
   * and the metadata server on its own, so one instance covers every way this module is deployed
   * and there is no separate code path for running on GCP.
   */
  protected readonly googleAuth: GcpGoogleAuth;

  public constructor(logger: LoggerService, scheduler: SchedulerService, config: Config) {
    const gcpConfig = config.getConfig('catalog.providers.gcp');
    const providerConfig = gcpConfig.getConfig(this.getProviderConfigKey());
    const schedule = readSchedulerServiceTaskScheduleDefinitionFromConfig(providerConfig.getConfig('schedule'));

    if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      logger.info(`Using GOOGLE_APPLICATION_CREDENTIALS: ${process.env.GOOGLE_APPLICATION_CREDENTIALS}`);
      const credentialsFile = fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8');
      this.credentials = JSON.parse(credentialsFile);
    } else {
      this.credentials = undefined;
    }
    // Parse the credentials file and create a BigQuery client
    // This assumes the credentials file is in JSON format
    // and contains the necessary fields for authentication.
    this.logger = logger;
    this.scheduleFn = this.createScheduleFn(scheduler.createScheduledTaskRunner(schedule));
    this.config = providerConfig;
    this.gcpConfig = gcpConfig;
    this.googleAuth = new google.auth.GoogleAuth({
      ...(this.credentials ? { credentials: this.credentials } : {}),
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
    this.client = this.getClient();
  }

  /**
   * Owner used for a resource that names none of its own.
   *
   * Read first from this provider's `owner`, then from the shared
   * `catalog.providers.gcp.defaultOwner`. The `unknown` fallback is a valid group ref, so the
   * catalog still accepts the entity, and an obviously wrong one, so unconfigured installations are
   * visible rather than silently misfiled.
   */
  protected get defaultOwner(): string {
    return this.config.getOptionalString('owner') ?? this.gcpConfig.getOptionalString('defaultOwner') ?? 'unknown';
  }

  /**
   * Label carrying the entity ref of a resource's owner, from this provider's `ownerLabel`, then
   * the shared `catalog.providers.gcp.ownerLabel`, then {@link DEFAULT_OWNER_LABEL}.
   */
  protected get ownerLabel(): string {
    return (
      this.config.getOptionalString('ownerLabel') ??
      this.gcpConfig.getOptionalString('ownerLabel') ??
      DEFAULT_OWNER_LABEL
    );
  }

  /**
   * Owner of a single resource, taken from its labels when they name one and falling back to
   * {@link defaultOwner} when they do not.
   *
   * Ownership is claimed on the GCP side rather than configured here, so a team that relabels a
   * resource moves it in the catalog without anyone touching Backstage config. A label that is not
   * a usable entity ref is logged and ignored, because a rejected entity would take the whole
   * project's mutation down with it.
   */
  protected ownerOf(labels: GcpLabels): string {
    const value = readLabel(labels, this.ownerLabel);
    if (!value) {
      return this.defaultOwner;
    }
    try {
      return parseOwnerRef(value);
    } catch (error) {
      this.logger.warn(
        `Ignoring ${this.ownerLabel}='${value}', not a valid entity ref, using ${this.defaultOwner} instead`,
        error as Error,
      );
      return this.defaultOwner;
    }
  }

  /**
   * Label carrying the entity ref of a resource's system, resolved like {@link ownerLabel}.
   */
  protected get systemLabel(): string {
    return (
      this.config.getOptionalString('systemLabel') ??
      this.gcpConfig.getOptionalString('systemLabel') ??
      DEFAULT_SYSTEM_LABEL
    );
  }

  /**
   * System used for a resource whose labels name none, from this provider's `system` then the
   * shared `defaultSystem`.
   *
   * Undefined means `spec.system` is left off. Unlike the owner there is no sensible catch-all: a
   * resource that belongs to no system is a normal thing to have, and inventing one would create a
   * dangling ref.
   */
  protected get defaultSystem(): string | undefined {
    return this.config.getOptionalString('system') ?? this.gcpConfig.getOptionalString('defaultSystem');
  }

  /**
   * The `spec.system` fragment for a resource, or nothing at all when neither its labels nor the
   * configuration name a system, so it can be spread into a spec without writing an empty value.
   *
   * As with the owner, a label that is not a usable entity ref is logged and ignored rather than
   * taking the whole project's mutation down with it.
   */
  protected systemOf(labels: GcpLabels): { system?: string } {
    const value = readLabel(labels, this.systemLabel);
    if (!value) {
      return this.defaultSystem ? { system: this.defaultSystem } : {};
    }
    try {
      return { system: parseSystemRef(value) };
    } catch (error) {
      this.logger.warn(
        `Ignoring ${this.systemLabel}='${value}', not a valid entity ref, using ${
          this.defaultSystem ?? 'no system'
        } instead`,
        error as Error,
      );
      return this.defaultSystem ? { system: this.defaultSystem } : {};
    }
  }

  /**
   * Region recorded when the GCP API reports none for a resource.
   *
   * Undefined means the region annotation is left off entirely — an absent region is honest, a
   * guessed one silently misplaces the resource.
   */
  protected get defaultRegion(): string | undefined {
    return this.config.getOptionalString('region') ?? this.gcpConfig.getOptionalString('defaultRegion');
  }

  /**
   * Namespace template for this provider, from its `namespace` then the shared `defaultNamespace`,
   * falling back to {@link DEFAULT_NAMESPACE_TEMPLATE}.
   */
  protected get namespaceTemplate(): string {
    return (
      this.config.getOptionalString('namespace') ??
      this.gcpConfig.getOptionalString('defaultNamespace') ??
      DEFAULT_NAMESPACE_TEMPLATE
    );
  }

  /** Namespace an entity of this provider lands in. */
  protected namespaceOf(context: GcpResourceContext): string {
    return this.renderNamespace(this.namespaceTemplate, context);
  }

  /**
   * Namespace another provider's entities land in, for building refs that point at them.
   *
   * Read from that provider's own config block so a relation still resolves when the two providers
   * are namespaced differently. A provider that is not configured at all still yields a namespace,
   * since the ref is worth emitting for the case where its target is ingested later.
   */
  protected namespaceOfProvider(providerConfigKey: string, context: GcpResourceContext): string {
    const template =
      this.gcpConfig.getOptionalConfig(providerConfigKey)?.getOptionalString('namespace') ??
      this.gcpConfig.getOptionalString('defaultNamespace') ??
      DEFAULT_NAMESPACE_TEMPLATE;
    return this.renderNamespace(template, context);
  }

  /**
   * A rendered template, normalized into something the catalog accepts as a namespace.
   *
   * A template that names an unknown variable is logged and dropped for the default namespace: the
   * entities are still ingested, in a visibly wrong place, rather than lost to a rejected mutation.
   */
  private renderNamespace(template: string, context: GcpResourceContext): string {
    let rendered: string;
    try {
      rendered = renderTemplate(template, context);
    } catch (error) {
      this.logger.warn(`Ignoring namespace template '${template}'`, error as Error);
      return DEFAULT_NAMESPACE_TEMPLATE;
    }
    return formatResourceName(rendered) || DEFAULT_NAMESPACE_TEMPLATE;
  }

  /**
   * Ref of an entity ingested by another provider, for `dependsOn` and friends.
   *
   * The namespace comes from that provider's own config block, so a relation still resolves when
   * the two providers are namespaced differently.
   */
  protected resourceRef(providerConfigKey: string, context: GcpResourceContext & { name: string }): string {
    const name = formatResourceName(context.name);
    const namespace = this.namespaceOfProvider(providerConfigKey, { ...context, name });
    return `resource:${namespace}/${name}`;
  }

  /** Ref of an entity this same provider ingests, for relations between its own resources. */
  protected ownRef(context: GcpResourceContext & { name: string }): string {
    const name = formatResourceName(context.name);
    return `resource:${this.namespaceOf({ ...context, name })}/${name}`;
  }

  /**
   * Ref of the entity a service account is ingested as.
   *
   * Accepts every spelling the APIs use: a bare email, an IAM member
   * (`serviceAccount:sa@project.iam.gserviceaccount.com`) and a resource path
   * (`projects/p/serviceAccounts/sa@project.iam.gserviceaccount.com`).
   *
   * The project comes from the account's own email domain, since a resource is regularly used by an
   * account from another project, and the ref is emitted whether or not that project is enumerated
   * here — it resolves if the account is ingested later.
   */
  protected serviceAccountRef(member: string): string {
    const email = lastSegment(member.split(':').pop() ?? member);
    const [accountName, domain] = email.split('@');
    return this.resourceRef('service-account', {
      projectId: domain?.split('.')[0] ?? '',
      type: 'google-service-account',
      provider: 'gcp-service-account',
      name: accountName,
    });
  }

  /** Ref of the VPC network a Compute resource URL points at. */
  protected vpcRef(networkUrl: string | null | undefined, fallbackProject: string): string {
    const network = parseResourceUrl(networkUrl);
    return this.resourceRef('vpc', {
      projectId: network.projectId ?? fallbackProject,
      type: 'vpc-network',
      provider: 'gcp-vpc',
      name: network.name,
    });
  }

  /**
   * Ref of the subnetwork a Compute resource URL points at.
   *
   * Subnet names repeat across regions — an auto-mode network has a `default` subnet in every one —
   * so the entity name, and this ref, carry the region.
   */
  protected subnetRef(subnetUrl: string | null | undefined, fallbackProject: string): string {
    const subnet = parseResourceUrl(subnetUrl);
    return this.resourceRef('subnets', {
      projectId: subnet.projectId ?? fallbackProject,
      type: 'subnetwork',
      provider: 'gcp-subnets',
      region: subnet.region,
      name: subnet.region ? `${subnet.name}-${subnet.region}` : subnet.name,
    });
  }

  /**
   * How IAM is read and which of it is kept.
   *
   * `enabled` defaults to true so the access graph exists without being asked for; a project whose
   * Cloud Asset API is off simply contributes no edges.
   */
  protected get iamOptions(): {
    enabled: boolean;
    memberTypes: string[];
    roles?: string[];
    excludeRoles: string[];
    maxEdges: number;
    annotateResources: boolean;
    index: GcpAssetIndexOptions;
  } {
    const iam = this.gcpConfig.getOptionalConfig('iam');
    return {
      enabled: iam?.getOptionalBoolean('enabled') ?? true,
      memberTypes: iam?.getOptionalStringArray('memberTypes') ?? ['serviceAccount'],
      roles: iam?.getOptionalStringArray('roles'),
      excludeRoles: iam?.getOptionalStringArray('excludeRoles') ?? [],
      maxEdges: iam?.getOptionalNumber('maxEdgesPerMember') ?? 200,
      annotateResources: iam?.getOptionalBoolean('annotateResources') ?? false,
      index: {
        cacheTtlMs: (iam?.getOptionalNumber('cacheTtlSeconds') ?? 600) * 1000,
        maxBindings: iam?.getOptionalNumber('maxBindingsPerProject') ?? 20000,
      },
    };
  }

  /**
   * The IAM index, shared with every other provider in this backend so one sweep serves all of
   * them. See {@link GcpAssetIndex}.
   */
  protected get assetIndex(): GcpAssetIndex {
    return getAssetIndex(
      google.cloudasset({ version: 'v1', auth: this.googleAuth }),
      this.logger,
      this.iamOptions.index,
    );
  }

  /**
   * Every project named by any provider under `catalog.providers.gcp`.
   *
   * IAM crosses provider boundaries — a service account in one project routinely holds a role on a
   * bucket in another — so the access graph is built from the union of configured projects rather
   * than from the projects of whichever provider happens to be asking.
   */
  protected get allConfiguredProjects(): string[] {
    const projects = new Set<string>();
    for (const key of this.gcpConfig.keys()) {
      // `catalog.providers.gcp` holds scalar defaults alongside the provider blocks, and reading a
      // string key as a config object throws, so the value is inspected before it is read.
      const value = this.gcpConfig.getOptional(key);
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        continue;
      }
      const configured = (value as { projects?: unknown }).projects;
      if (!Array.isArray(configured)) {
        continue;
      }
      for (const project of configured) {
        if (typeof project === 'string') {
          projects.add(project);
        }
      }
    }
    return [...projects];
  }

  /**
   * IAM policies for every configured project, keyed by project.
   *
   * Empty when IAM is switched off, so a caller can treat "no policies" and "no access" the same
   * way and needs no branch of its own.
   */
  protected async iamPolicies(): Promise<Map<string, GcpProjectPolicies>> {
    const policies = new Map<string, GcpProjectPolicies>();
    if (!this.iamOptions.enabled) {
      return policies;
    }
    const index = this.assetIndex;
    await Promise.all(
      this.allConfiguredProjects.map(async project => {
        policies.set(project, await index.policiesOf(project));
      }),
    );
    return policies;
  }

  /** Whether a role passes the configured `roles` allowlist and `excludeRoles` denylist. */
  protected iamRoleWanted(role: string): boolean {
    const { roles, excludeRoles } = this.iamOptions;
    if (excludeRoles.includes(role)) {
      return false;
    }
    return !roles || roles.includes(role);
  }

  /**
   * Ref of the entity a Cloud Asset Inventory asset is ingested as, or undefined when nothing in
   * this module ingests that asset type.
   *
   * This is what turns an IAM binding into a relation: the policy names its resource as
   * `//storage.googleapis.com/projects/_/buckets/reports`, and the registry in `src/iam/assetTypes`
   * knows which provider ingests buckets, so that provider's namespace template applies.
   */
  protected refForAsset(assetName: string, assetType: string, fallbackProject: string): string | undefined {
    const parsed = parseAsset(assetName, assetType);
    if (!parsed) {
      return undefined;
    }
    const { mapping, projectId, region, leaf } = parsed;

    if (mapping.nameStyle === 'serviceAccount') {
      return this.serviceAccountRef(leaf);
    }

    let name = leaf;
    if (mapping.nameStyle === 'subnet' && region) {
      name = `${leaf}-${region}`;
    } else if (mapping.nameStyle === 'pubsub') {
      const prefixes = this.gcpConfig.getOptionalConfig('pubsub')?.getOptionalStringArray('stripPrefixes') ?? [];
      name = stripPrefixes(leaf, prefixes);
    }

    return this.resourceRef(mapping.configKey, {
      projectId: projectId ?? fallbackProject,
      type: mapping.type,
      provider: mapping.provider,
      region,
      name,
    });
  }

  /**
   * Ref of the entity a Pub/Sub topic is ingested as, from a `projects/p/topics/t` name.
   *
   * The Pub/Sub provider strips configured prefixes off the names it ingests, so the same stripping
   * is applied here — otherwise every relation pointing at a topic would dangle in an installation
   * that uses `stripPrefixes`.
   */
  protected pubsubTopicRef(topicName: string | null | undefined, fallbackProject: string): string {
    const prefixes = this.gcpConfig.getOptionalConfig('pubsub')?.getOptionalStringArray('stripPrefixes') ?? [];
    return this.resourceRef('pubsub', {
      projectId: segmentAfter(topicName, 'projects') ?? fallbackProject,
      type: 'pubsub-topic',
      provider: 'gcp-pubsub',
      name: stripPrefixes(lastSegment(topicName), prefixes),
    });
  }

  /** Ref of the entity a Cloud Run service is ingested as. */
  protected cloudRunServiceRef(service: string, region: string | undefined, projectId: string): string {
    return this.resourceRef('run', {
      projectId,
      type: 'cloud-run-service',
      provider: 'gcp-run',
      region,
      name: lastSegment(service),
    });
  }

  /**
   * Which link families are written, from this provider's `links` block then the shared one.
   *
   * Resolved key by key rather than block by block, so setting `links.logs` on one provider does
   * not silently drop the console and documentation links the shared block turned on.
   */
  protected get linkOptions(): LinkOptions {
    const read = (key: keyof LinkOptions): boolean =>
      this.config.getOptionalBoolean(`links.${key}`) ??
      this.gcpConfig.getOptionalBoolean(`links.${key}`) ??
      DEFAULT_LINK_OPTIONS[key];
    return { console: read('console'), docs: read('docs'), logs: read('logs') };
  }

  /** Which facts become tags, resolved key by key like {@link linkOptions}. All off by default. */
  protected get tagOptions(): TagOptions {
    const flag = (key: keyof TagOptions): boolean =>
      this.config.getOptionalBoolean(`tags.${key}`) ?? this.gcpConfig.getOptionalBoolean(`tags.${key}`) ?? false;
    return {
      fromLabels: flag('fromLabels'),
      labelKeys:
        this.config.getOptionalStringArray('tags.labelKeys') ??
        this.gcpConfig.getOptionalStringArray('tags.labelKeys') ??
        NO_TAGS.labelKeys,
      resourceType: flag('resourceType'),
      region: flag('region'),
      project: flag('project'),
      attributes: flag('attributes'),
    };
  }

  /**
   * Whether a resource with no description of its own gets the generated one-liner. On by default:
   * a catalog of entities with no description at all reads as broken.
   */
  protected get generateDescriptions(): boolean {
    return this.config.getOptionalBoolean('descriptions') ?? this.gcpConfig.getOptionalBoolean('descriptions') ?? true;
  }

  /**
   * Links configured for this provider, with their URLs rendered against the resource.
   *
   * A link whose template names an unknown variable is logged and skipped, on the same grounds as
   * the namespace template: one bad config line should not cost the entity its other links.
   */
  private extraLinks(context: GcpResourceContext): EntityLink[] {
    const configured = this.config.getOptionalConfigArray('extraLinks') ?? [];
    const links: EntityLink[] = [];
    for (const link of configured) {
      const url = link.getString('url');
      try {
        links.push({
          url: renderTemplate(url, context),
          ...(link.getOptionalString('title') ? { title: link.getString('title') } : {}),
          ...(link.getOptionalString('icon') ? { icon: link.getString('icon') } : {}),
          ...(link.getOptionalString('type') ? { type: link.getString('type') } : {}),
        });
      } catch (error) {
        this.logger.warn(`Ignoring extra link '${url}'`, error as Error);
      }
    }
    return links;
  }

  /** Tags for a resource, empty unless some tag source is configured. */
  private tagsOf(resource: GcpResource, region: string | undefined): string[] {
    const options = this.tagOptions;
    const labels = toEntityLabels(resource.labels);
    const candidates: (string | null | undefined)[] = [];

    if (options.resourceType) {
      candidates.push(resource.type);
    }
    if (options.project) {
      candidates.push(resource.projectId);
    }
    if (options.region) {
      candidates.push(region);
    }
    if (options.fromLabels) {
      candidates.push(...Object.entries(labels).map(([key, value]) => `${key}-${value}`));
    }
    for (const key of options.labelKeys) {
      candidates.push(readLabel(resource.labels, key));
    }
    if (options.attributes) {
      candidates.push(...(resource.tagValues ?? []));
    }

    return toEntityTags(candidates);
  }

  /**
   * The metadata every ingested entity shares: a normalized name, the templated namespace, the GCP
   * labels copied over, the project, region and self link annotations, and the console and
   * documentation links.
   *
   * Provider-specific annotations are merged last so a provider can override any of these.
   */
  protected metadataOf(resource: GcpResource): {
    name: string;
    namespace: string;
    title?: string;
    description?: string;
    labels: Record<string, string>;
    annotations: Record<string, string>;
    tags?: string[];
    links?: EntityLink[];
  } {
    const name = formatResourceName(resource.name);
    const region = resource.region ?? this.defaultRegion;
    const context: GcpResourceContext = {
      projectId: resource.projectId,
      type: resource.type,
      provider: this.getProviderName(),
      region: region ?? undefined,
      name,
    };
    // The GCP name is kept as the title whenever normalization changed it, so an entity called
    // `my-bucket-name` still shows the `My_Bucket.Name` someone would search the console for.
    const title = resource.title ?? (name === resource.name ? undefined : resource.name);
    const description = resource.description ?? (this.generateDescriptions ? resource.summary : undefined);
    const tags = this.tagsOf(resource, region ?? undefined);
    const links = buildLinks({
      links: this.linkOptions,
      projectId: resource.projectId,
      type: resource.type,
      consolePath: resource.consolePath,
      docsUrl: resource.docsUrl,
      logFilter: resource.logFilter,
      extra: [...(resource.links ?? []), ...this.extraLinks(context)],
    });

    return {
      name,
      namespace: this.namespaceOf(context),
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      labels: toEntityLabels(resource.labels),
      annotations: {
        [ANNOTATION_GCP_PROJECT_ID]: resource.projectId,
        ...regionAnnotation(region),
        ...selfLinkAnnotation(resource.selfLink),
        ...resource.annotations,
      },
      ...(tags.length > 0 ? { tags } : {}),
      ...(links.length > 0 ? { links } : {}),
    };
  }

  /**
   * Access token for the GCP APIs, for the rare call made outside a client library.
   *
   * Delegated to {@link googleAuth}, which reaches the metadata server when running on GCP and uses
   * the configured credentials otherwise, refreshing the token as it expires.
   */
  protected async getAccessToken(): Promise<string> {
    const token = await this.googleAuth.getAccessToken();
    if (!token) {
      throw new Error('No access token available from the configured Google credentials');
    }
    return token;
  }

  abstract getProviderName(): string;

  abstract getProviderConfigKey(): string;

  abstract getClient(): TClient;

  async connect(connection: EntityProviderConnection): Promise<void> {
    this.connection = connection;
    await this.scheduleFn();
  }

  private createScheduleFn(taskRunner: SchedulerServiceTaskRunner): () => Promise<void> {
    return async () => {
      const taskId = `${this.getProviderName()}:refresh`;
      return taskRunner.run({
        id: taskId,
        fn: async () => {
          try {
            await this.refresh();
          } catch (error) {
            this.logger.error('Error:', error as Error);
          }
        },
      });
    };
  }

  abstract getResources(): Promise<DeferredEntity[]>;

  async refresh() {
    if (!this.connection) {
      throw new Error('Not initialized');
    }

    this.logger.info('Discovering GCP resources');

    let resources: DeferredEntity[];

    try {
      resources = await this.getResources();
    } catch (e) {
      this.logger.error('error fetching GCP resources', e as Error);
      return;
    }

    this.logger.info(`Ingesting GCP resources [${resources.map(r => r.entity.metadata.name).join(', ')}]`);

    await this.connection.applyMutation({
      type: 'full',
      entities: resources,
    });
  }
}
