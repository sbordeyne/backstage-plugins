import { ANNOTATION_LOCATION, ANNOTATION_ORIGIN_LOCATION, Entity } from '@backstage/catalog-model';
import {
  CoverageStats,
  GithubRepositoryInfo,
  IntegrationStatus,
  Perimeter,
  ProviderSkip,
  RepositoryLocation,
  RepositoryRow,
} from '../types';
import { isGeneratedLocation, isRootCatalogPath, parseResolvedCatalogPath, toOriginLocationRef } from './locations';
import { isInPerimeter } from './perimeter';

/** The entities a single provider location produced. */
interface IngestedEntities {
  paths: Set<string>;
  kinds: Set<string>;
  count: number;
}

export interface BuildRepositoryRowsOptions {
  locations: RepositoryLocation[];
  /** Non-Location entities carrying a github origin annotation. */
  children: Entity[];
  /** GitHub metadata indexed by repository name. */
  githubRepositories: Map<string, GithubRepositoryInfo>;
  /**
   * Whether GitHub enrichment succeeded. When false, drift cannot be told apart from a missing
   * file, so uningested repositories are reported as `unknown` rather than `not-integrated`.
   */
  githubEnrichmentAvailable: boolean;
}

function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Groups child entities by the provider location that produced them. */
function groupChildrenByOrigin(children: Entity[]): Map<string, IngestedEntities> {
  const byOrigin = new Map<string, IngestedEntities>();

  for (const child of children) {
    // The provider's own Location entity is its own origin, so counting it would make every
    // repository look integrated. A Location a catalog-info.yaml declares by hand is a genuine
    // product of that file and does count.
    if (isGeneratedLocation(child)) {
      continue;
    }

    const origin = child.metadata.annotations?.[ANNOTATION_ORIGIN_LOCATION];
    if (!origin) {
      continue;
    }

    const ingested = byOrigin.get(origin) ?? { paths: new Set<string>(), kinds: new Set<string>(), count: 0 };
    ingested.count += 1;
    ingested.kinds.add(child.kind);

    const ownLocation = child.metadata.annotations?.[ANNOTATION_LOCATION];
    const path = ownLocation ? parseResolvedCatalogPath(ownLocation) : undefined;
    if (path) {
      ingested.paths.add(path);
    }

    byOrigin.set(origin, ingested);
  }

  return byOrigin;
}

function resolveStatus(
  ingested: IngestedEntities | undefined,
  github: GithubRepositoryInfo | undefined,
  githubEnrichmentAvailable: boolean,
): IntegrationStatus {
  if (ingested && ingested.count > 0) {
    const hasRootFile = [...ingested.paths].some(isRootCatalogPath);
    // An unparseable path still proves entities were ingested, so treat it as a normal integration.
    return hasRootFile || ingested.paths.size === 0 ? 'integrated' : 'integrated-nested';
  }
  if (!githubEnrichmentAvailable || !github) {
    return 'unknown';
  }
  return github.hasRootCatalogInfo ? 'drift' : 'not-integrated';
}

/**
 * Why the provider does not walk a repository, read from GitHub rather than from the catalog.
 *
 * A repository archived since the last sync still has its `Location`, so trusting the catalog here
 * would keep it in the perimeter after GitHub has already put it out of reach.
 */
function resolveProviderSkips(github: GithubRepositoryInfo | undefined): ProviderSkip[] {
  if (!github) {
    return [];
  }

  const skips: ProviderSkip[] = [];
  if (github.isArchived) {
    skips.push('archived');
  }
  if (github.isFork) {
    skips.push('fork');
  }
  if (!github.hasDefaultBranch) {
    skips.push('no-default-branch');
  }
  return skips;
}

function toRepositoryRow(
  identity: { repo: string; org: string },
  ingested: IngestedEntities | undefined,
  github: GithubRepositoryInfo | undefined,
  githubEnrichmentAvailable: boolean,
  isTracked: boolean,
): RepositoryRow {
  return {
    repo: identity.repo,
    org: identity.org,
    url: github?.url ?? `https://github.com/${identity.org}/${identity.repo}`,
    status: resolveStatus(ingested, github, githubEnrichmentAvailable),
    catalogInfoPaths: [...(ingested?.paths ?? [])].sort(),
    entityCount: ingested?.count ?? 0,
    entityKinds: [...(ingested?.kinds ?? [])].sort(),
    primaryLanguage: github?.primaryLanguage,
    pushedAt: github?.pushedAt,
    isPrivate: github?.isPrivate,
    defaultBranch: github?.defaultBranch,
    isTracked,
    providerSkips: resolveProviderSkips(github),
  };
}

/**
 * Joins provider locations, the entities they produced, and GitHub metadata into table rows.
 *
 * The inventory is the **union** of the two sides. The provider emits no `Location` for archived
 * repositories, forks or empty ones, and listing only what it walks would hide exactly the
 * repositories this page exists to surface. GitHub already returns them, so the union costs nothing.
 */
export function buildRepositoryRows(options: BuildRepositoryRowsOptions): RepositoryRow[] {
  const { locations, children, githubRepositories, githubEnrichmentAvailable } = options;
  const byOrigin = groupChildrenByOrigin(children);

  const tracked = locations.map(location =>
    toRepositoryRow(
      location,
      byOrigin.get(toOriginLocationRef(location.target)),
      githubRepositories.get(location.repo),
      githubEnrichmentAvailable,
      true,
    ),
  );

  const trackedNames = new Set(locations.map(location => location.repo));
  // An untracked row only exists because GitHub answered, so enrichment is available by construction.
  const untracked = [...githubRepositories.values()]
    .filter(github => !trackedNames.has(github.name))
    .map(github => toRepositoryRow({ repo: github.name, org: github.owner }, undefined, github, true, false));

  return [...tracked, ...untracked].sort((a, b) => a.repo.localeCompare(b.repo));
}

/** Whether a repository counts as integrated for the binary "integrated / not integrated" filter. */
export function isCovered(status: IntegrationStatus): boolean {
  return status === 'integrated' || status === 'integrated-nested';
}

function countByStatus(rows: RepositoryRow[], status: IntegrationStatus): number {
  return rows.filter(row => row.status === status).length;
}

/**
 * Aggregates the coverage KPI over the repositories inside the perimeter.
 *
 * The perimeter is the only thing that moves this figure. The table's own status filter and search
 * are reading aids: were they to reach the denominator, filtering on "not integrated" would report
 * 100 % not integrated.
 */
export function summarizeCoverage(rows: RepositoryRow[], perimeter: Perimeter): CoverageStats {
  const scoped = rows.filter(row => isInPerimeter(row, perimeter));
  const total = scoped.length;
  const integrated = scoped.filter(row => isCovered(row.status)).length;
  const notIntegrated = total - integrated;
  const uncoveredPercentage = total === 0 ? 0 : roundToOneDecimal((notIntegrated / total) * 100);

  return {
    total,
    integrated,
    notIntegrated,
    drift: countByStatus(scoped, 'drift'),
    nestedOnly: countByStatus(scoped, 'integrated-nested'),
    unknown: countByStatus(scoped, 'unknown'),
    entityCount: scoped.reduce((sum, row) => sum + row.entityCount, 0),
    uncoveredPercentage,
    coveredPercentage: total === 0 ? 0 : roundToOneDecimal(100 - uncoveredPercentage),
  };
}

/**
 * The repositories worth onboarding next: uncovered, most recently pushed first, with drift
 * ahead of everything else since a committed-but-not-ingested file is the cheapest fix.
 *
 * Repositories the provider will never walk are left out whatever the perimeter says. Onboarding one
 * cannot put it in the catalog, so a worklist that suggested it would not be a list of things to do.
 */
export function selectUncoveredRepositories(
  rows: RepositoryRow[],
  perimeter: Perimeter,
  limit: number,
): RepositoryRow[] {
  return rows
    .filter(row => isInPerimeter(row, perimeter) && !isCovered(row.status) && row.providerSkips.length === 0)
    .sort((a, b) => {
      if (a.status !== b.status) {
        if (a.status === 'drift') return -1;
        if (b.status === 'drift') return 1;
      }
      return (b.pushedAt ?? '').localeCompare(a.pushedAt ?? '');
    })
    .slice(0, limit);
}
