import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { ANNOTATION_LOCATION, ANNOTATION_ORIGIN_LOCATION } from '@backstage/catalog-model';
import { GcpEntityProviderBase, GcpResource } from './GcpEntityProviderBase';
import { formatResourceNameOrUndefined, isPermanentlyEmpty, truncateAnnotation } from '../utils';
import { GcpProjectPolicies } from '../iam';
import { ANNOTATION_GCP_IAM_MEMBERS } from '../constants';
import { ASSET_HOST_BY_TYPE } from '../resourceTypes';
import { StructuralRelationKind } from '../relations';

/**
 * Pages a single listing may fetch, so a runaway `nextPageToken` cannot loop forever.
 *
 * Hitting it is an error rather than a short result: every provider applies a `full` mutation, in
 * which "the listing stopped early" and "these resources no longer exist" are the same thing.
 */
const MAX_PAGES = 100;

/** One page of a `list` call, as the `googleapis` clients report it under `data`. */
export interface GcpListPage<T> {
  items?: T[] | null;
  nextPageToken?: string | null;
}

/** One page of a Compute `aggregatedList` call: results bucketed by zone, region or `global`. */
export interface GcpAggregatedListPage<TScoped> {
  items?: Record<string, TScoped> | null;
  nextPageToken?: string | null;
}

/**
 * A structural relation as it is carried on the entity.
 *
 * Custom relation types cannot be expressed in a spec field the catalog understands, so the edge
 * travels as data and `GcpRelationProcessor` turns it into the real relation rows.
 */
export interface GcpStructuralRelation {
  type: StructuralRelationKind;
  targetRef: string;
  /** The entity spec is plain JSON, so this has to be assignable to it. */
  [key: string]: string;
}

/**
 * The relations a provider can declare on one resource.
 *
 * Every list tolerates `undefined` entries and drops them, because a ref builder answers undefined
 * for a target whose name normalizes to nothing. That keeps the call sites reading as a plain list
 * of refs rather than each one having to filter, and keeps an unusable target from costing the
 * resource its entity.
 */
export interface GcpRelations {
  /** Plain dependencies: this resource needs that one to work. */
  dependsOn?: (string | undefined)[];
  /** The reverse, for the rare edge that reads better declared from this side. */
  dependencyOf?: (string | undefined)[];
  /** Containment: a Spanner database is part of its instance. */
  partOf?: (string | undefined)[];
  /** Attachment: a GKE cluster is plugged into its subnet, but is not part of it. */
  attachedTo?: (string | undefined)[];
}

/** The refs of a declared relation list, with the ones that could not be built dropped. */
function definedRefs(refs: (string | undefined)[] | undefined): string[] {
  return (refs ?? []).filter((ref): ref is string => Boolean(ref));
}

/** An item from an aggregated listing, with the scope it was found in. */
export interface GcpScopedItem<T> {
  item: T;
  /** Bare scope name, e.g. `europe-west1-b`, `europe-west1` or `global`. */
  scope: string;
  /** Whether the scope was a zone, a region or global. */
  scopeKind: 'zone' | 'region' | 'global';
}

/** Whether an aggregated-list bucket key names a zone, a region or the global scope. */
function scopeKindOf(scopeKey: string): GcpScopedItem<unknown>['scopeKind'] {
  if (scopeKey.startsWith('zones/')) {
    return 'zone';
  }
  return scopeKey.startsWith('regions/') ? 'region' : 'global';
}

/**
 * Base for the providers built on the `googleapis` REST clients: project iteration, pagination and
 * the error handling all of them would otherwise repeat.
 */
export abstract class GcpRestEntityProvider<TApi> extends GcpEntityProviderBase<TApi> {
  /**
   * Projects this provider enumerates, from its own `projects` then the shared
   * `catalog.providers.gcp.projects`.
   *
   * Most installations point every provider at the same estate, and repeating the list under each
   * of fifty-odd config keys is the kind of duplication that goes stale one key at a time. A
   * provider that does name its own projects overrides the shared list rather than adding to it, so
   * narrowing one resource type to a single project stays a local edit.
   */
  protected get projects(): string[] {
    const projects = this.once('projects', () =>
      this.config.getOptionalStringArray('projects') ?? this.gcpConfig.getOptionalStringArray('projects'),
    );
    if (!projects?.length) {
      throw new Error(
        `No projects for the GCP ${this.getProviderConfigKey()} provider: set 'projects' on the ` +
          `provider or on catalog.providers.gcp to share one list across providers`,
      );
    }
    return projects;
  }

  /**
   * Locations this provider is restricted to, or undefined for all of them.
   *
   * Distinct from `region`, which is the fallback recorded when the API reports none: this one
   * bounds the calls that would otherwise sweep every location in a project.
   */
  protected get locations(): string[] | undefined {
    return this.once('locations', () => {
      const locations = this.config.getOptionalStringArray('locations');
      return locations && locations.length > 0 ? locations : undefined;
    });
  }

  /** True when a resource in this location should be ingested, given {@link locations}. */
  protected includesLocation(location: string | null | undefined): boolean {
    const locations = this.locations;
    if (!locations) {
      return true;
    }
    if (!location) {
      return false;
    }
    // A zone belongs to its region, so `locations: [europe-west1]` keeps `europe-west1-b`.
    return locations.some(configured => location === configured || location.startsWith(`${configured}-`));
  }

  /**
   * Policies of each project, populated only when `iam.annotateResources` asks for the resource-side
   * annotation. Keyed by project, because the projects are enumerated in parallel.
   */
  private readonly policiesByProject = new Map<string, GcpProjectPolicies>();

  /**
   * Runs `fn` once per configured project and flattens the results.
   *
   * A project that answers 403 or 404 contributes nothing and is logged once; see
   * {@link isPermanentlyEmpty} for why every other failure is left to propagate.
   */
  protected async forEachProject<T>(fn: (project: string) => Promise<T[]>): Promise<T[]> {
    await this.prefetchPolicies();
    const perProject = await Promise.all(
      this.projects.map(async project => {
        this.logger.info(`Discovering ${this.getProviderName()} resources in project: ${project}`);
        try {
          const found = await fn(project);
          this.logger.info(`Found ${found.length} ${this.getProviderName()} resources in project: ${project}`);
          return found;
        } catch (error) {
          if (isPermanentlyEmpty(error)) {
            this.logger.warn(
              `Skipping project ${project} for ${this.getProviderName()}: the API is disabled, the project is gone, ` +
                `or the credentials cannot read it`,
              error as Error,
            );
            return [];
          }
          throw error;
        }
      }),
    );
    return perProject.flat();
  }

  /**
   * Reads every project's IAM policies up front when the resource-side annotation is switched on.
   *
   * The index caches and shares the sweep, so this costs at most one call per project per TTL even
   * with every provider doing it.
   */
  private async prefetchPolicies(): Promise<void> {
    const iam = this.iamOptions;
    if (!iam.enabled || !iam.annotateResources) {
      return;
    }
    const index = this.assetIndex;
    await Promise.all(
      this.projects.map(async project => {
        this.policiesByProject.set(project, await index.policiesOf(project));
      }),
    );
    // Same reasoning as `iamPolicies`: these annotations go out in a `full` mutation, so a sweep
    // that stopped early would have them removed from the entities it did not reach.
    const truncated = [...this.policiesByProject.entries()]
      .filter(([, project]) => project.truncated)
      .map(([name]) => name);
    if (truncated.length > 0) {
      throw new Error(
        `IAM policies for ${truncated.join(', ')} were truncated at iam.maxBindingsPerProject, so the ` +
          `${ANNOTATION_GCP_IAM_MEMBERS} annotations would be incomplete; raise it, or narrow iam.roles.`,
      );
    }
  }

  /**
   * `roles/storage.objectViewer=ci-runner@…,backstage@…` for one resource, or nothing when the
   * annotation is off, the resource named no asset, or nobody holds a role on it.
   *
   * This is the audit view — who can touch this — and is deliberately separate from the relations,
   * which exist only for principals the catalog actually ingests.
   */
  /**
   * Cloud Asset Inventory name of a resource, from the one the provider set or derived from its
   * self link.
   *
   * Only ten of the fifty-odd providers used to set one, so `iam.annotateResources` silently
   * covered a fifth of the estate: the annotation is looked up by asset name, and a resource
   * without one simply never matched. The registry already knows the host each type is named
   * under, and a CAI name is that host followed by the resource path — which is what a self link
   * carries after its API version. Deriving it makes the option mean the same thing everywhere.
   *
   * Resources whose names are not project-scoped — a bucket is `//storage.googleapis.com/<name>` —
   * do not follow the rule and set their own.
   */
  protected assetNameOf(resource: GcpResource): string | undefined {
    if (resource.assetName) {
      return resource.assetName;
    }
    const host = ASSET_HOST_BY_TYPE.get(resource.type);
    if (!host || !resource.selfLink) {
      return undefined;
    }
    // Matched as a whole segment: a resource whose own name contains `projects/` would otherwise
    // have the path read from the wrong offset.
    const segments = resource.selfLink.replace(/^https?:\/\/[^/]+\//, '').split('/');
    const start = segments.indexOf('projects');
    return start < 0 ? undefined : `//${host}/${segments.slice(start).join('/')}`;
  }

  /** Bindings Cloud Asset Inventory reported for a resource, under the asset name it is known by. */
  private bindingsOf(assetName: string | undefined, projectId: string) {
    return assetName ? this.policiesByProject.get(projectId)?.membersByAsset.get(assetName) : undefined;
  }

  private iamMembersAnnotation(
    bindings: { role: string; members: string[] }[] | undefined,
  ): Record<string, string> {
    if (!bindings?.length) {
      return {};
    }
    const rendered = bindings
      .filter(binding => this.iamRoleWanted(binding.role))
      .map(binding => ({ role: binding.role, members: binding.members.filter(m => this.iamMemberWanted(m)) }))
      .filter(binding => binding.members.length > 0)
      .map(binding => `${binding.role}=${binding.members.join(',')}`)
      .join(';');
    return rendered ? { [ANNOTATION_GCP_IAM_MEMBERS]: truncateAnnotation(rendered) } : {};
  }

  /**
   * A `Resource` entity for one GCP resource: the shared metadata, the owner and system read off
   * its labels, and whatever relations the provider found.
   *
   * Every REST provider ends in this call, so the entity shape stays identical across resource
   * types and a provider is left holding only the mapping that is actually specific to it.
   */
  protected toEntity(resource: GcpResource, relations?: GcpRelations): DeferredEntity | undefined {
    const mode = this.relationMode;

    // Checked on its own rather than by catching everything `metadataOf` might throw, so a failure
    // elsewhere — a malformed `extraLinks` block, say — surfaces as itself instead of being
    // reported as an unusable name. A name of punctuation alone yields no entity name, and an
    // entity the catalog rejects fails the whole mutation: skipping this one resource costs its
    // entry, keeping it costs the rest.
    if (!formatResourceNameOrUndefined(resource.name)) {
      this.logger.warn(
        `Skipping ${this.getProviderName()} resource in ${resource.projectId}: no entity name can be ` +
          `built from '${resource.name}'`,
      );
      return undefined;
    }

    const location = `${this.getProviderName()}:${resource.selfLink ?? resource.name}`;
    const assetName = this.assetNameOf(resource);
    const bindings = this.bindingsOf(assetName, resource.projectId);
    // The annotation records the name Cloud Asset Inventory knows the resource by, so it is only
    // written where that is certain: one the provider spelled out, or a derived one the policy
    // lookup just matched. The derivation is a good guess — several services name their assets by
    // project *number*, which a self link does not carry — and a plausible wrong answer published
    // as fact is worse than none, while a wrong guess used only for the lookup simply misses.
    const knownAssetName = resource.assetName ?? (bindings?.length ? assetName : undefined);
    const metadata = this.metadataOf({
      ...resource,
      assetName: knownAssetName,
      annotations: {
        [ANNOTATION_LOCATION]: location,
        [ANNOTATION_ORIGIN_LOCATION]: location,
        ...this.iamMembersAnnotation(bindings),
        ...resource.annotations,
      },
    });

    // Containment and attachment are dependencies in the built-in vocabulary and relations of
    // their own in the GCP one, where they are handed to the processor that can emit custom types.
    const structural: GcpStructuralRelation[] = [
      ...definedRefs(relations?.partOf).map(targetRef => ({ type: 'partOf' as const, targetRef })),
      ...definedRefs(relations?.attachedTo).map(targetRef => ({ type: 'attachedTo' as const, targetRef })),
    ];
    const dependsOn = [
      ...definedRefs(relations?.dependsOn),
      ...(mode === 'builtin' ? structural.map(relation => relation.targetRef) : []),
    ];
    const dependencyOf = definedRefs(relations?.dependencyOf);

    return {
      entity: {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Resource',
        metadata,
        spec: {
          type: resource.type,
          owner: this.ownerOf(resource.labels),
          ...this.systemOf(resource.labels),
          ...(dependsOn.length ? { dependsOn } : {}),
          ...(dependencyOf.length ? { dependencyOf } : {}),
          ...(mode === 'gcp' && structural.length ? { gcpRelations: structural } : {}),
        },
      },
    };
  }

  /** Every item of a paginated listing, following `nextPageToken` up to {@link MAX_PAGES}. */
  protected async listAll<T>(page: (pageToken?: string) => Promise<GcpListPage<T>>): Promise<T[]> {
    const items: T[] = [];
    let pageToken: string | undefined;
    for (let fetched = 0; fetched < MAX_PAGES; fetched++) {
      const response = await page(pageToken);
      items.push(...(response.items ?? []));
      pageToken = response.nextPageToken ?? undefined;
      if (!pageToken) {
        return items;
      }
    }
    throw new Error(
      `Stopped paginating ${this.getProviderName()} after ${MAX_PAGES} pages. The result would be ` +
        `incomplete, and a provider applies a full mutation, so ingesting it would delete every ` +
        `resource beyond the last page read. Narrow the provider with 'locations' or a state filter.`,
    );
  }

  /**
   * Every item of a Compute `aggregatedList`, tagged with the zone or region it came from.
   *
   * `pick` pulls the typed array out of a scope bucket — the field is named after the resource
   * (`instances`, `subnetworks`, `routers`), so only the caller knows which one to read. Buckets
   * carrying only a `warning` — the API's way of saying "nothing in this zone" — yield nothing.
   */
  protected async listAggregated<T, TScoped>(
    page: (pageToken?: string) => Promise<GcpAggregatedListPage<TScoped>>,
    pick: (scoped: TScoped) => T[] | null | undefined,
  ): Promise<GcpScopedItem<T>[]> {
    const found: GcpScopedItem<T>[] = [];
    let pageToken: string | undefined;
    for (let fetched = 0; fetched < MAX_PAGES; fetched++) {
      const response = await page(pageToken);
      for (const [scopeKey, scoped] of Object.entries(response.items ?? {})) {
        const items = pick(scoped) ?? [];
        if (items.length === 0) {
          continue;
        }
        const scopeKind = scopeKindOf(scopeKey);
        const scope = scopeKey.split('/').pop() ?? scopeKey;
        // A global resource belongs to no location, so `locations` has nothing to say about it.
        if (scopeKind !== 'global' && !this.includesLocation(scope)) {
          continue;
        }
        found.push(...items.map(item => ({ item, scope, scopeKind })));
      }
      pageToken = response.nextPageToken ?? undefined;
      if (!pageToken) {
        return found;
      }
    }
    throw new Error(
      `Stopped paginating ${this.getProviderName()} after ${MAX_PAGES} pages. The result would be ` +
        `incomplete, and a provider applies a full mutation, so ingesting it would delete every ` +
        `resource beyond the last page read. Narrow the provider with 'locations' or a state filter.`,
    );
  }
}
