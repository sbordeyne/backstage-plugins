import { DeferredEntity } from '@backstage/plugin-catalog-node';
import { ANNOTATION_LOCATION, ANNOTATION_ORIGIN_LOCATION } from '@backstage/catalog-model';
import { GcpEntityProviderBase, GcpResource } from './GcpEntityProviderBase';
import { isPermanentlyEmpty, truncateAnnotation } from '../utils';
import { GcpProjectPolicies } from '../iam';
import { ANNOTATION_GCP_IAM_MEMBERS } from '../constants';

/** Pages a single listing may fetch, so a runaway `nextPageToken` cannot loop forever. */
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
  /** Projects this provider enumerates. */
  protected get projects(): string[] {
    return this.config.getStringArray('projects');
  }

  /**
   * Locations this provider is restricted to, or undefined for all of them.
   *
   * Distinct from `region`, which is the fallback recorded when the API reports none: this one
   * bounds the calls that would otherwise sweep every location in a project.
   */
  protected get locations(): string[] | undefined {
    const locations = this.config.getOptionalStringArray('locations');
    return locations && locations.length > 0 ? locations : undefined;
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
  }

  /**
   * `roles/storage.objectViewer=ci-runner@…,backstage@…` for one resource, or nothing when the
   * annotation is off, the resource named no asset, or nobody holds a role on it.
   *
   * This is the audit view — who can touch this — and is deliberately separate from the relations,
   * which exist only for principals the catalog actually ingests.
   */
  private iamMembersAnnotation(resource: GcpResource): Record<string, string> {
    if (!resource.assetName) {
      return {};
    }
    const bindings = this.policiesByProject.get(resource.projectId)?.membersByAsset.get(resource.assetName);
    if (!bindings?.length) {
      return {};
    }
    const rendered = bindings
      .filter(binding => this.iamRoleWanted(binding.role))
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
  protected toEntity(
    resource: GcpResource,
    relations?: { dependsOn?: string[]; dependencyOf?: string[] },
  ): DeferredEntity {
    const location = `${this.getProviderName()}:${resource.selfLink ?? resource.name}`;
    return {
      entity: {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Resource',
        metadata: this.metadataOf({
          ...resource,
          annotations: {
            [ANNOTATION_LOCATION]: location,
            [ANNOTATION_ORIGIN_LOCATION]: location,
            ...this.iamMembersAnnotation(resource),
            ...resource.annotations,
          },
        }),
        spec: {
          type: resource.type,
          owner: this.ownerOf(resource.labels),
          ...this.systemOf(resource.labels),
          ...(relations?.dependsOn?.length ? { dependsOn: relations.dependsOn } : {}),
          ...(relations?.dependencyOf?.length ? { dependencyOf: relations.dependencyOf } : {}),
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
    this.logger.warn(`Stopped paginating ${this.getProviderName()} after ${MAX_PAGES} pages, results are incomplete`);
    return items;
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
    this.logger.warn(`Stopped paginating ${this.getProviderName()} after ${MAX_PAGES} pages, results are incomplete`);
    return found;
  }
}
