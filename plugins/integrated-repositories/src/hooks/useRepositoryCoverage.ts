import { useCallback, useMemo, useState } from 'react';
import { ANNOTATION_ORIGIN_LOCATION, Entity } from '@backstage/catalog-model';
import { useApi } from '@backstage/core-plugin-api';
import { CatalogApi, catalogApiRef } from '@backstage/plugin-catalog-react';
import useAsync from 'react-use/lib/useAsync';
import { GithubRepositoryApi, githubRepositoryApiRef } from '../api';
import { buildRepositoryRows, collectLanguageOptions, countRepositoriesWithoutLocation } from '../lib/coverage';
import { parseGeneratedLocation, toOriginLocationRef } from '../lib/locations';
import { GithubRepositoryInfo, LanguageOption, OrganizationRef, RepositoryLocation, RepositoryRow } from '../types';

/**
 * Origin refs are ~95 characters each, so filtering on all of them at once would produce a URL of
 * roughly 20 kB. Chunks of 50 keep each request near 5 kB while needing only three round trips for
 * an organization of this size.
 */
const ORIGIN_FILTER_CHUNK_SIZE = 50;

export interface RepositoryCoverage {
  rows: RepositoryRow[];
  /** Selectable primary languages, empty until enrichment lands. */
  languageOptions: LanguageOption[];
  /** GitHub repositories the provider does not track, i.e. archived repositories and forks. */
  untrackedRepositoryCount: number;
  /** The repository inventory is still loading; nothing can be rendered yet. */
  inventoryPending: boolean;
  /** Integration status and the coverage KPI are not known yet. */
  ingestionPending: boolean;
  /** Language, recency, visibility and drift are not known yet. */
  enrichmentPending: boolean;
  githubEnrichmentAvailable: boolean;
  /** Set when GitHub enrichment failed; the catalog-only view is still usable. */
  enrichmentError?: Error;
  /** Only a failure to read the inventory is fatal for the page. */
  error?: Error;
  /** Re-runs the GitHub stage, bypassing its cache. */
  refreshEnrichment: () => void;
}

interface GithubEnrichment {
  repositories: Map<string, GithubRepositoryInfo>;
  error?: Error;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

/** Every repository in the organization, courtesy of the provider emitting an optional Location per repo. */
async function fetchGeneratedLocations(catalogApi: CatalogApi): Promise<RepositoryLocation[]> {
  const { items } = await catalogApi.getEntities({
    filter: { kind: 'Location', 'spec.type': 'url' },
    fields: ['kind', 'metadata.name', 'spec.type', 'spec.target'],
  });

  return items.map(parseGeneratedLocation).filter((location): location is RepositoryLocation => location !== undefined);
}

/**
 * The entities each provider location actually produced.
 *
 * Annotation keys are not requested through `fields` because field paths split on `.`, which would
 * mangle `backstage.io/managed-by-location`.
 */
async function fetchIngestedEntities(catalogApi: CatalogApi, locations: RepositoryLocation[]): Promise<Entity[]> {
  const originRefs = locations.map(location => toOriginLocationRef(location.target));
  if (originRefs.length === 0) {
    return [];
  }

  const responses = await Promise.all(
    chunk(originRefs, ORIGIN_FILTER_CHUNK_SIZE).map(refs =>
      catalogApi.getEntities({
        filter: { [`metadata.annotations.${ANNOTATION_ORIGIN_LOCATION}`]: refs },
        fields: ['kind', 'metadata.name', 'metadata.namespace', 'metadata.annotations'],
      }),
    ),
  );

  return responses.flatMap(response => response.items);
}

function distinctOrganizations(locations: RepositoryLocation[]): OrganizationRef[] {
  const organizations = new Map<string, OrganizationRef>();
  for (const { host, org } of locations) {
    organizations.set(`${host}/${org}`, { host, org });
  }
  return [...organizations.values()];
}

/** Enrichment is best-effort: without it the page still renders, with drift reported as unknown. */
async function enrichFromGithub(
  githubApi: GithubRepositoryApi,
  organizations: OrganizationRef[],
): Promise<GithubEnrichment> {
  try {
    const results = await Promise.all(
      organizations.map(organization => githubApi.listOrganizationRepositories(organization)),
    );
    return { repositories: new Map(results.flat().map(repository => [repository.name, repository])) };
  } catch (caught) {
    return {
      repositories: new Map(),
      error: caught instanceof Error ? caught : new Error(String(caught)),
    };
  }
}

const NO_REPOSITORIES = new Map<string, GithubRepositoryInfo>();

/**
 * Whether a dependent stage has actually produced its result.
 *
 * `useAsync` only switches to `loading` from inside its own effect, which runs *after* the render
 * that follows a dependency change. So the render where the inventory first becomes available still
 * carries the previous, empty state of the stages that depend on it, with `loading` false. Reporting
 * that frame as loaded would paint a KPI computed from no ingestion at all — 100 % not integrated —
 * before correcting itself. Treating "no value and no error yet" as still pending closes the gap.
 */
function isSettled<T>(stage: { value?: T; error?: Error }): boolean {
  return stage.value !== undefined || stage.error !== undefined;
}

/**
 * Loads coverage in three independent stages so each part of the page can render as soon as its own
 * data arrives, instead of the whole page waiting on the slowest leg (GitHub, whose pages are
 * necessarily sequential).
 *
 * Ingestion and enrichment both depend only on the inventory, so they run concurrently.
 */
export function useRepositoryCoverage(): RepositoryCoverage {
  const catalogApi = useApi(catalogApiRef);
  const githubApi = useApi(githubRepositoryApiRef);
  const [enrichmentAttempt, setEnrichmentAttempt] = useState(0);

  const inventory = useAsync(() => fetchGeneratedLocations(catalogApi), [catalogApi]);
  const locations = inventory.value;

  const ingestion = useAsync(
    async () => (locations ? fetchIngestedEntities(catalogApi, locations) : undefined),
    [catalogApi, locations],
  );

  const enrichment = useAsync(
    async () => (locations ? enrichFromGithub(githubApi, distinctOrganizations(locations)) : undefined),
    [githubApi, locations, enrichmentAttempt],
  );

  const refreshEnrichment = useCallback(() => {
    githubApi.invalidate();
    setEnrichmentAttempt(attempt => attempt + 1);
  }, [githubApi]);

  const githubRepositories = enrichment.value?.repositories ?? NO_REPOSITORIES;
  const githubEnrichmentAvailable = enrichment.value !== undefined && enrichment.value.error === undefined;

  const rows = useMemo(
    () =>
      buildRepositoryRows({
        locations: locations ?? [],
        children: ingestion.value ?? [],
        githubRepositories,
        githubEnrichmentAvailable,
      }),
    [locations, ingestion.value, githubRepositories, githubEnrichmentAvailable],
  );

  const languageOptions = useMemo(() => collectLanguageOptions(rows), [rows]);

  const untrackedRepositoryCount = useMemo(
    () => (locations ? countRepositoriesWithoutLocation(locations, githubRepositories) : 0),
    [locations, githubRepositories],
  );

  return {
    rows,
    languageOptions,
    untrackedRepositoryCount,
    inventoryPending: inventory.loading,
    ingestionPending: inventory.loading || ingestion.loading || !isSettled(ingestion),
    enrichmentPending: inventory.loading || enrichment.loading || !isSettled(enrichment),
    githubEnrichmentAvailable,
    enrichmentError: enrichment.value?.error,
    error: inventory.error ?? ingestion.error,
    refreshEnrichment,
  };
}
