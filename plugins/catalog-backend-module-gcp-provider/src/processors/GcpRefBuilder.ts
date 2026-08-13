import { Config } from '@backstage/config';
import { LoggerService } from '@backstage/backend-plugin-api';
import { DEFAULT_NAMESPACE_TEMPLATE } from '../constants';
import { parseAsset } from '../iam';
import { formatResourceName, GcpResourceContext, lastSegment, renderTemplate, stripPrefixes } from '../utils';

/**
 * Builds entity refs the way the providers do, from `catalog.providers.gcp` alone.
 *
 * The providers own this logic naturally — each knows its own namespace template — but the relation
 * processor needs the same answers without being a provider, so it lives here and both use it.
 */
export class GcpRefBuilder {
  constructor(private readonly gcpConfig: Config, private readonly logger?: LoggerService) {}

  /**
   * Namespace a given provider's entities land in.
   *
   * A template naming an unknown variable is logged and dropped for the default namespace, so one
   * bad config line misplaces entities rather than losing them.
   */
  namespaceFor(providerConfigKey: string, context: GcpResourceContext): string {
    const template =
      this.blockOf(providerConfigKey)?.namespace ??
      this.gcpConfig.getOptionalString('defaultNamespace') ??
      DEFAULT_NAMESPACE_TEMPLATE;
    try {
      return formatResourceName(renderTemplate(template, context)) || DEFAULT_NAMESPACE_TEMPLATE;
    } catch (error) {
      this.logger?.warn(`Ignoring namespace template '${template}'`, error as Error);
      return DEFAULT_NAMESPACE_TEMPLATE;
    }
  }

  /** Ref of an entity a given provider ingests. */
  resourceRef(providerConfigKey: string, context: GcpResourceContext & { name: string }): string {
    const name = formatResourceName(context.name);
    return `resource:${this.namespaceFor(providerConfigKey, { ...context, name })}/${name}`;
  }

  /** Ref of the entity a service account is ingested as, from a member, email or resource path. */
  serviceAccountRef(member: string): string {
    const email = lastSegment(member.split(':').pop() ?? member);
    const [accountName, domain] = email.split('@');
    return this.resourceRef('service-account', {
      projectId: domain?.split('.')[0] ?? '',
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
      return this.serviceAccountRef(leaf);
    }

    let name = leaf;
    if (mapping.nameStyle === 'subnet' && region) {
      name = `${leaf}-${region}`;
    } else if (mapping.nameStyle === 'pubsub') {
      name = stripPrefixes(leaf, this.blockOf('pubsub')?.stripPrefixes ?? []);
    }

    return this.resourceRef(mapping.configKey, {
      projectId: projectId ?? fallbackProject,
      type: mapping.type,
      provider: mapping.provider,
      region,
      name,
    });
  }

  /** Every project named by any provider, since IAM crosses provider boundaries. */
  allConfiguredProjects(): string[] {
    const projects = new Set<string>();
    for (const key of this.gcpConfig.keys()) {
      for (const project of this.blockOf(key)?.projects ?? []) {
        projects.add(project);
      }
    }
    return [...projects];
  }

  /** Whether a role passes the configured allowlist and denylist. */
  roleWanted(role: string): boolean {
    const excluded = this.gcpConfig.getOptionalStringArray('iam.excludeRoles') ?? [];
    if (excluded.includes(role)) {
      return false;
    }
    const allowed = this.gcpConfig.getOptionalStringArray('iam.roles');
    return !allowed || allowed.includes(role);
  }

  /**
   * One provider block, read as plain data.
   *
   * `catalog.providers.gcp` mixes scalar defaults in with the provider blocks, and reading a string
   * key as a config object throws, so the value is inspected before it is used.
   */
  private blockOf(key: string): { projects?: string[]; namespace?: string; stripPrefixes?: string[] } | undefined {
    const value = this.gcpConfig.getOptional(key);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    const block = value as { projects?: unknown; namespace?: unknown; stripPrefixes?: unknown };
    const strings = (candidate: unknown): string[] | undefined =>
      Array.isArray(candidate) ? candidate.filter((item): item is string => typeof item === 'string') : undefined;
    return {
      projects: strings(block.projects),
      namespace: typeof block.namespace === 'string' ? block.namespace : undefined,
      stripPrefixes: strings(block.stripPrefixes),
    };
  }
}
