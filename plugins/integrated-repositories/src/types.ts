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

/** The binary "integrated / not integrated" filter driving the table and the KPI. */
export type CoverageFilter = 'all' | 'integrated' | 'not-integrated';

/**
 * Option id standing for repositories where GitHub reports no primary language, so that they stay
 * selectable rather than being silently unfilterable.
 */
export const UNKNOWN_LANGUAGE = '__unknown__';

/**
 * Languages selected by default when `integratedRepositories.defaultLanguages` is not configured.
 *
 * Empty means "all languages", which is the only neutral choice for an installation whose
 * perimeter we know nothing about. Set the config key to pin the headline coverage figure to a
 * fixed set of languages so it stays comparable week to week.
 */
export const DEFAULT_LANGUAGES: readonly string[] = [];

/** A selectable primary language, derived from the repositories actually present. */
export interface LanguageOption {
  /** Either the language name, or {@link UNKNOWN_LANGUAGE}. */
  id: string;
  label: string;
  repositoryCount: number;
}

/** A repository as described by the GitHub GraphQL API. */
export interface GithubRepositoryInfo {
  name: string;
  url: string;
  isPrivate: boolean;
  pushedAt?: string;
  primaryLanguage?: string;
  /** True when a `catalog-info.yaml` exists at the root of the default branch. */
  hasRootCatalogInfo: boolean;
}

/** A repository discovered from a `generated-*` `Location` entity. */
export interface RepositoryLocation {
  /** SCM host, so GitHub Enterprise targets keep working. */
  host: string;
  org: string;
  repo: string;
  /** The raw `spec.target`, used to join child entities by origin annotation. */
  target: string;
}

/** Identifies the organization to enumerate on a given SCM host. */
export interface OrganizationRef {
  host: string;
  org: string;
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
}

/** Aggregated coverage figures for the selected languages. */
export interface CoverageStats {
  total: number;
  integrated: number;
  notIntegrated: number;
  drift: number;
  nestedOnly: number;
  unknown: number;
  /** Total catalog entities produced by the repositories in scope. */
  entityCount: number;
  /** The headline KPI: the share of repositories not covered by the catalog. */
  uncoveredPercentage: number;
  coveredPercentage: number;
}
