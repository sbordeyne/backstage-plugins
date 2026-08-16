/**
 * How a GitHub repository relates to the Backstage catalog.
 *
 * The `github` catalog provider emits a `Location` entity for every repository in the
 * organization regardless of whether a `catalog-info.yaml` exists, so the presence of a
 * `Location` says nothing on its own — only the entities it produced do.
 */
export type IntegrationStatus =
  /** The location produced entities, at least one from a root `catalog-info.yaml`. */
  | 'integrated'
  /** The location produced entities, but only from nested paths (a monorepo). */
  | 'integrated-nested'
  /** No entities, yet GitHub reports a root `catalog-info.yaml` — committed but not ingested. */
  | 'drift'
  /** No entities and no root `catalog-info.yaml`. */
  | 'not-integrated'
  /** No entities, and GitHub enrichment was unavailable so we cannot tell drift apart. */
  | 'unknown';

/**
 * The table's single status filter.
 *
 * It carries both granularities the page needs: the binary integrated / not integrated grouping
 * required by IDP-47, and each individual status. Two separate controls said the same thing twice.
 */
export type StatusFilter = 'all' | 'covered' | 'uncovered' | IntegrationStatus;

/**
 * Option id standing for repositories where GitHub reports no primary language, so that they stay
 * selectable rather than being silently unfilterable.
 */
export const UNKNOWN_LANGUAGE = '__unknown__';

/** A selectable primary language, derived from the repositories actually present. */
export interface LanguageOption {
  /** Either the language name, or {@link UNKNOWN_LANGUAGE}. */
  id: string;
  label: string;
  repositoryCount: number;
}

/**
 * A reason the catalog provider does not walk a repository.
 *
 * These are the three the `github` provider applies with no `filters` block configured: archived
 * repositories, forks, and repositories with no default branch.
 */
export type ProviderSkip = 'archived' | 'fork' | 'no-default-branch';

/**
 * What a repository is, from the provider's point of view.
 *
 * `active` is the one the provider actually walks — everything else is a reason it does not. A
 * repository can be more than one at once: an archived fork is both.
 */
export type RepositoryKind = 'active' | ProviderSkip;

/** A selectable repository kind, with how many repositories selecting it would bring in. */
export interface KindOption {
  id: RepositoryKind;
  label: string;
  repositoryCount: number;
}

/**
 * The population the page describes: the rows *and* the denominator of the coverage figure.
 *
 * Perimeter controls move both together, so the headline figure always describes exactly what is on
 * screen. The table's own status filter and search are reading aids and deliberately not part of it.
 */
export interface Perimeter {
  /** Selected primary languages. Empty means every language. */
  languages: string[];
  /** Selected repository kinds. Empty means every kind. */
  kinds: RepositoryKind[];
}

/** A repository as described by the GitHub GraphQL API. */
export interface GithubRepositoryInfo {
  name: string;
  /** The organization or user the repository belongs to. */
  owner: string;
  url: string;
  isPrivate: boolean;
  isArchived: boolean;
  isFork: boolean;
  defaultBranch?: string;
  /** False for an empty repository, which the provider skips along with archived ones and forks. */
  hasDefaultBranch: boolean;
  pushedAt?: string;
  primaryLanguage?: string;
  /** True when a `catalog-info.yaml` exists at the root of the default branch. */
  hasRootCatalogInfo: boolean;
}

/** A repository discovered from a `generated-*` `Location` entity. */
export interface RepositoryLocation {
  org: string;
  repo: string;
  /** The raw `spec.target`, used to join child entities by origin annotation. */
  target: string;
}

/** One row of the repositories table. */
export interface RepositoryRow {
  repo: string;
  org: string;
  /** Link to the repository on GitHub. */
  url: string;
  status: IntegrationStatus;
  /** Resolved `catalog-info.yaml` paths, sorted. Empty when nothing was ingested. */
  catalogInfoPaths: string[];
  entityCount: number;
  /** Distinct kinds of the entities produced, sorted. */
  entityKinds: string[];
  primaryLanguage?: string;
  pushedAt?: string;
  isPrivate?: boolean;
  /** Whether the provider emitted a `Location` for this repository. */
  isTracked: boolean;
  /** Why the provider does not walk it, sorted. Empty when it does. */
  providerSkips: ProviderSkip[];
  /** The default branch the provider would have walked. */
  defaultBranch?: string;
}

/** Aggregated coverage figures for the repositories inside the perimeter. */
export interface CoverageStats {
  total: number;
  integrated: number;
  notIntegrated: number;
  drift: number;
  nestedOnly: number;
  unknown: number;
  /** Total catalog entities produced by the repositories in scope. */
  entityCount: number;
  /** The headline KPI required by IDP-47. */
  uncoveredPercentage: number;
  coveredPercentage: number;
}
