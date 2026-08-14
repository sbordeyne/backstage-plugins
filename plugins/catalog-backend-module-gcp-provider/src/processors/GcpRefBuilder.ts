import { Config } from '@backstage/config';
import { LoggerService } from '@backstage/backend-plugin-api';
import { DEFAULT_NAMESPACE_TEMPLATE, FALLBACK_NAMESPACE } from '../constants';
import { parseAsset } from '../iam';
import { RESOURCE_CONFIG_KEYS } from '../resourceTypes';
import { RelationMode } from '../relations';
import {
  formatResourceNameOrUndefined,
  GcpResourceContext,
  lastSegment,
  pubsubSubscriptionName,
  renderTemplate,
  serviceAccountProject,
  stripPrefixes,
} from '../utils';

/**
 * Builds entity refs the way the providers do, from `catalog.providers.gcp` alone.
 *
 * The providers own this logic naturally — each knows its own namespace template — but the relation
 * processor needs the same answers without being a provider, so it lives here and both use it.
 */
export class GcpRefBuilder {
  /**
   * Backing store for {@link once}.
   *
   * `namespaceFor` runs for every entity and every ref built towards one, and each call used to
   * re-read the provider's block and the shared default. Configuration is fixed for the life of the
   * process, so these are constants that happen to be read rather than computed.
   */
  private readonly memo = new Map<string, unknown>();

  constructor(private readonly gcpConfig: Config, private readonly logger?: LoggerService) {}

  /** A configured value, resolved on first use and kept. */
  private once<T>(key: string, compute: () => T): T {
    if (!this.memo.has(key)) {
      this.memo.set(key, compute());
    }
    return this.memo.get(key) as T;
  }

  /**
   * Namespace a given provider's entities land in.
   *
   * A template naming an unknown variable is logged and dropped for the default namespace, so one
   * bad config line misplaces entities rather than losing them.
   */
  namespaceFor(providerConfigKey: string, context: GcpResourceContext): string {
    const template = this.once(
      `namespace:${providerConfigKey}`,
      () =>
        this.blockOf(providerConfigKey)?.namespace ??
        this.gcpConfig.getOptionalString('defaultNamespace') ??
        DEFAULT_NAMESPACE_TEMPLATE,
    );
    try {
      return formatResourceNameOrUndefined(renderTemplate(template, context)) ?? FALLBACK_NAMESPACE;
    } catch (error) {
      this.logger?.warn(`Ignoring namespace template '${template}'`, error as Error);
      return FALLBACK_NAMESPACE;
    }
  }

  /**
   * Ref of an entity a given provider ingests, or undefined when the target name normalizes to
   * nothing.
   *
   * A ref built from an unusable name points at an entity that can never exist, and emitting
   * `resource:namespace/` would have the catalog reject the entity carrying the relation. Dropping
   * the edge keeps that resource, minus one relation that was never going to resolve.
   */
  resourceRef(providerConfigKey: string, context: GcpResourceContext & { name: string }): string | undefined {
    const name = formatResourceNameOrUndefined(context.name);
    if (!name) {
      this.logger?.warn(`No entity name can be built from '${context.name}', dropping the relation to it`);
      return undefined;
    }
    return `resource:${this.namespaceFor(providerConfigKey, { ...context, name })}/${name}`;
  }

  /**
   * Ref of the entity a service account is ingested as, from a member, email or resource path.
   *
   * `fallbackProject` is required rather than optional: it stands in for the accounts whose email
   * does not name their project — the default compute and App Engine agents above all, which are
   * exactly the identities workloads run as — and without it those refs render an empty
   * `{{projectId}}`, collapsing every one of them into a single namespace named after nothing. Every
   * caller knows a project, so there is no case for letting one be left out.
   * See {@link serviceAccountProject}.
   */
  serviceAccountRef(member: string, fallbackProject: string): string | undefined {
    const email = lastSegment(member.split(':').pop() ?? member);
    const [accountName] = email.split('@');
    return this.resourceRef('service-account', {
      projectId: serviceAccountProject(email) ?? fallbackProject,
      type: 'google-service-account',
      provider: 'gcp-service-account',
      name: accountName,
    });
  }

  /**
   * Ref of the entity a Cloud Asset Inventory asset is ingested as, when anything ingests it.
   *
   * `fallbackProject` is the project the sweep that produced the asset was scoped to. It stands in
   * whenever the asset name carries no usable project id — including the common case where it
   * carries the project *number*, which no entity is ever named after.
   */
  refForAsset(assetName: string, assetType: string, fallbackProject: string): string | undefined {
    const parsed = parseAsset(assetName, assetType);
    if (!parsed) {
      return undefined;
    }
    const { mapping, projectId, region, leaf } = parsed;

    if (mapping.nameStyle === 'serviceAccount') {
      // The asset name carries the project the account lives in, which is the answer for the
      // agent accounts whose own email does not name one.
      return this.serviceAccountRef(leaf, projectId ?? fallbackProject);
    }

    let name = leaf;
    if (mapping.nameStyle === 'subnet' && region) {
      name = `${leaf}-${region}`;
    } else if (mapping.nameStyle === 'pubsub') {
      name = stripPrefixes(leaf, this.blockOf('pubsub')?.stripPrefixes ?? []);
    } else if (mapping.nameStyle === 'pubsubSubscription') {
      name = pubsubSubscriptionName(stripPrefixes(leaf, this.blockOf('pubsub')?.stripPrefixes ?? []));
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
   * Every project named by any provider, since IAM crosses provider boundaries.
   *
   * Read from the resource-type registry rather than from every key under `catalog.providers.gcp`,
   * so the shared blocks that sit alongside the providers — `iam`, `links`, `tags` — are not
   * mistaken for ones. A provider block that names no projects of its own uses the shared list,
   * matching how the providers themselves resolve it, and one turned off by `enabled: false`
   * contributes nothing — otherwise disabling a provider would still cost its projects a sweep.
   */
  allConfiguredProjects(): string[] {
    const shared = this.gcpConfig.getOptionalStringArray('projects') ?? [];
    const projects = new Set<string>();
    for (const key of RESOURCE_CONFIG_KEYS) {
      const block = this.blockOf(key);
      if (!block || block.enabled === false) {
        continue;
      }
      for (const project of block.projects ?? shared) {
        projects.add(project);
      }
    }
    return [...projects];
  }

  /**
   * The relation vocabulary a given provider emits, from its own `relations` then the shared
   * `iam.relations`, defaulting to `builtin`.
   *
   * Resolved here rather than in each of the two places that need it. The providers write the
   * relations and the processor turns the structural ones into real edges, so if the two disagreed
   * about a provider's mode — as they did while the processor read only the shared key — a provider
   * set to `gcp` under a `builtin` default would emit edges the processor never converted, and they
   * would be lost rather than merely spelled differently.
   */
  relationModeFor(providerConfigKey?: string): RelationMode {
    return this.once(`relations:${providerConfigKey ?? ''}`, () => {
      const configured =
        (providerConfigKey ? this.gcpConfig.getOptionalString(`${providerConfigKey}.relations`) : undefined) ??
        this.gcpConfig.getOptionalString('iam.relations') ??
        'builtin';
      if (configured !== 'builtin' && configured !== 'gcp') {
        this.logger?.warn(`Unknown relation mode '${configured}', using builtin`);
        return 'builtin';
      }
      return configured;
    });
  }

  /** Whether a role passes the configured allowlist and denylist. */
  roleWanted(role: string): boolean {
    // Read once: this runs per grant, and a broadly-granted account holds thousands.
    const excluded = this.once('excludeRoles', () => this.gcpConfig.getOptionalStringArray('iam.excludeRoles') ?? []);
    if (excluded.includes(role)) {
      return false;
    }
    const allowed = this.once('roles', () => this.gcpConfig.getOptionalStringArray('iam.roles'));
    return !allowed || allowed.includes(role);
  }

  /**
   * One provider block, read as plain data.
   *
   * `catalog.providers.gcp` mixes scalar defaults in with the provider blocks, and reading a string
   * key as a config object throws, so the value is inspected before it is used.
   */
  private blockOf(
    key: string,
  ): { projects?: string[]; namespace?: string; stripPrefixes?: string[]; enabled?: boolean } | undefined {
    return this.once(`block:${key}`, () => this.readBlock(key));
  }

  private readBlock(
    key: string,
  ): { projects?: string[]; namespace?: string; stripPrefixes?: string[]; enabled?: boolean } | undefined {
    const value = this.gcpConfig.getOptional(key);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    const block = value as { projects?: unknown; namespace?: unknown; stripPrefixes?: unknown; enabled?: unknown };
    const strings = (candidate: unknown): string[] | undefined =>
      Array.isArray(candidate) ? candidate.filter((item): item is string => typeof item === 'string') : undefined;
    return {
      projects: strings(block.projects),
      namespace: typeof block.namespace === 'string' ? block.namespace : undefined,
      stripPrefixes: strings(block.stripPrefixes),
      enabled: typeof block.enabled === 'boolean' ? block.enabled : undefined,
    };
  }
}
