import { ANNOTATION_LOCATION, ANNOTATION_ORIGIN_LOCATION, Entity } from '@backstage/catalog-model';
import {
  CoverageStats,
  GithubRepositoryInfo,
  IntegrationStatus,
  LanguageOption,
  RepositoryLocation,
  RepositoryRow,
  UNKNOWN_LANGUAGE,
} from '../types';
import { isRootCatalogPath, parseResolvedCatalogPath, toOriginLocationRef } from './locations';

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
    // The provider's own Location entity is its own origin, so counting Locations would make
    // every repository look integrated. Only the entities a catalog-info.yaml produced count.
    if (child.kind === 'Location') {
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

function toRepositoryRow(
  location: RepositoryLocation,
  ingested: IngestedEntities | undefined,
  github: GithubRepositoryInfo | undefined,
  githubEnrichmentAvailable: boolean,
): RepositoryRow {
  return {
    repo: location.repo,
    org: location.org,
    url: github?.url ?? `https://github.com/${location.org}/${location.repo}`,
    status: resolveStatus(ingested, github, githubEnrichmentAvailable),
    catalogInfoPaths: [...(ingested?.paths ?? [])].sort(),
    entityCount: ingested?.count ?? 0,
    entityKinds: [...(ingested?.kinds ?? [])].sort(),
    primaryLanguage: github?.primaryLanguage,
    pushedAt: github?.pushedAt,
    isPrivate: github?.isPrivate,
  };
}

/** Joins provider locations, the entities they produced, and GitHub metadata into table rows. */
export function buildRepositoryRows(options: BuildRepositoryRowsOptions): RepositoryRow[] {
  const { locations, children, githubRepositories, githubEnrichmentAvailable } = options;
  const byOrigin = groupChildrenByOrigin(children);

  return locations
    .map(location =>
      toRepositoryRow(
        location,
        byOrigin.get(toOriginLocationRef(location.target)),
        githubRepositories.get(location.repo),
        githubEnrichmentAvailable,
      ),
    )
    .sort((a, b) => a.repo.localeCompare(b.repo));
}

/** Whether a repository counts as integrated for the binary "integrated / not integrated" filter. */
export function isCovered(status: IntegrationStatus): boolean {
  return status === 'integrated' || status === 'integrated-nested';
}

/**
 * Whether a repository falls inside the selected languages.
 *
 * An empty selection means "no language filter", so it matches everything rather than nothing —
 * clearing the control must never blank the page. A repository with no detected language matches
 * only the explicit {@link UNKNOWN_LANGUAGE} option.
 */
export function isLanguageSelected(row: RepositoryRow, selectedLanguages: readonly string[]): boolean {
  if (selectedLanguages.length === 0) {
    return true;
  }
  if (row.primaryLanguage === undefined) {
    return selectedLanguages.includes(UNKNOWN_LANGUAGE);
  }
  const language = row.primaryLanguage.toLowerCase();
  return selectedLanguages.some(selected => selected.toLowerCase() === language);
}

/**
 * The selectable languages, derived from the repositories themselves so the list always matches the
 * organization. Ordered by repository count so the dominant languages come first.
 */
export function collectLanguageOptions(rows: RepositoryRow[]): LanguageOption[] {
  const counts = new Map<string, number>();
  let withoutLanguage = 0;

  for (const row of rows) {
    if (row.primaryLanguage === undefined) {
      withoutLanguage += 1;
    } else {
      counts.set(row.primaryLanguage, (counts.get(row.primaryLanguage) ?? 0) + 1);
    }
  }

  const options = [...counts.entries()]
    .map(([label, repositoryCount]) => ({ id: label, label, repositoryCount }))
    .sort((a, b) => b.repositoryCount - a.repositoryCount || a.label.localeCompare(b.label));

  if (withoutLanguage > 0) {
    options.push({ id: UNKNOWN_LANGUAGE, label: 'Unknown', repositoryCount: withoutLanguage });
  }
  return options;
}

function countByStatus(rows: RepositoryRow[], status: IntegrationStatus): number {
  return rows.filter(row => row.status === status).length;
}

/** Aggregates the coverage KPI over the repositories in the selected languages. */
export function summarizeCoverage(rows: RepositoryRow[], selectedLanguages: readonly string[]): CoverageStats {
  const scoped = rows.filter(row => isLanguageSelected(row, selectedLanguages));
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
 */
export function selectUncoveredRepositories(
  rows: RepositoryRow[],
  selectedLanguages: readonly string[],
  limit: number,
): RepositoryRow[] {
  return rows
    .filter(row => isLanguageSelected(row, selectedLanguages) && !isCovered(row.status))
    .sort((a, b) => {
      if (a.status !== b.status) {
        if (a.status === 'drift') return -1;
        if (b.status === 'drift') return 1;
      }
      return (b.pushedAt ?? '').localeCompare(a.pushedAt ?? '');
    })
    .slice(0, limit);
}

/** GitHub repositories the catalog provider does not track, i.e. archived repositories and forks. */
export function countRepositoriesWithoutLocation(
  locations: RepositoryLocation[],
  githubRepositories: Map<string, GithubRepositoryInfo>,
): number {
  const tracked = new Set(locations.map(location => location.repo));
  return [...githubRepositories.values()].filter(repository => !tracked.has(repository.name)).length;
}
