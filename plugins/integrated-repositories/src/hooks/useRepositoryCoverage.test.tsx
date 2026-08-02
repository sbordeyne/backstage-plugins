import { act, render, waitFor } from '@testing-library/react';
import { ANNOTATION_LOCATION, ANNOTATION_ORIGIN_LOCATION, Entity } from '@backstage/catalog-model';
import { CatalogApi, catalogApiRef } from '@backstage/plugin-catalog-react';
import { TestApiProvider } from '@backstage/test-utils';
import { GithubRepositoryApi, githubRepositoryApiRef } from '../api';
import { RepositoryCoverage, useRepositoryCoverage } from './useRepositoryCoverage';
import { GithubRepositoryInfo, UNKNOWN_LANGUAGE } from '../types';

const ORG = 'example-org';

function target(repo: string): string {
  return `https://github.com/${ORG}/${repo}/blob/master/**/catalog-info.yaml`;
}

function locationEntity(repo: string, index: number): Entity {
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Location',
    metadata: {
      name: `generated-${index}`,
      annotations: {
        [ANNOTATION_LOCATION]: `url:${target(repo)}`,
        [ANNOTATION_ORIGIN_LOCATION]: `url:${target(repo)}`,
      },
    },
    spec: { type: 'url', target: target(repo), presence: 'optional' },
  } as Entity;
}

function componentEntity(repo: string, path: string): Entity {
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: {
      name: repo,
      annotations: {
        [ANNOTATION_LOCATION]: `url:https://github.com/${ORG}/${repo}/tree/master/${path}`,
        [ANNOTATION_ORIGIN_LOCATION]: `url:${target(repo)}`,
      },
    },
  } as Entity;
}

function githubRepository(repo: string, overrides: Partial<GithubRepositoryInfo> = {}): GithubRepositoryInfo {
  return {
    name: repo,
    url: `https://github.com/${ORG}/${repo}`,
    isPrivate: true,
    pushedAt: '2026-07-30T00:00:00Z',
    primaryLanguage: 'Java',
    hasRootCatalogInfo: false,
    ...overrides,
  };
}

/** The inventory stage is the only one that filters on `kind`. */
function isInventoryQuery(filter: unknown): boolean {
  return typeof filter === 'object' && filter !== null && !Array.isArray(filter) && 'kind' in filter;
}

interface Scenario {
  locations: Entity[];
  children: Entity[];
  githubRepositories?: GithubRepositoryInfo[];
  githubError?: Error;
  inventoryError?: Error;
}

interface Harness {
  /** Every state the hook rendered, oldest first. */
  snapshots: RepositoryCoverage[];
  latest: () => RepositoryCoverage;
  originFilters: string[][];
  githubApi: GithubRepositoryApi;
}

function renderCoverage(scenario: Scenario): Harness {
  const snapshots: RepositoryCoverage[] = [];
  const originFilters: string[][] = [];

  const catalogApi = {
    async getEntities(request?: { filter?: unknown }) {
      if (isInventoryQuery(request?.filter)) {
        if (scenario.inventoryError) {
          throw scenario.inventoryError;
        }
        return { items: scenario.locations };
      }

      const filter = request?.filter as Record<string, string[]>;
      const refs = filter[`metadata.annotations.${ANNOTATION_ORIGIN_LOCATION}`];
      originFilters.push(refs);
      return {
        items: scenario.children.filter(child =>
          refs.includes(child.metadata.annotations![ANNOTATION_ORIGIN_LOCATION]),
        ),
      };
    },
  } as unknown as CatalogApi;

  const githubApi: GithubRepositoryApi = {
    listOrganizationRepositories: jest.fn(async () => {
      if (scenario.githubError) {
        throw scenario.githubError;
      }
      return scenario.githubRepositories ?? [];
    }),
    invalidate: jest.fn(),
  };

  function Probe(): JSX.Element {
    snapshots.push(useRepositoryCoverage());
    return <div data-testid="probe" />;
  }

  render(
    <TestApiProvider
      apis={[
        [catalogApiRef, catalogApi],
        [githubRepositoryApiRef, githubApi],
      ]}
    >
      <Probe />
    </TestApiProvider>,
  );

  return {
    snapshots,
    latest: () => snapshots[snapshots.length - 1],
    originFilters,
    githubApi,
  };
}

const CARBON_ROWS = {
  locations: [locationEntity('carbon', 0), locationEntity('salt', 1)],
  children: [componentEntity('carbon', 'catalog-info.yaml')],
};

describe('useRepositoryCoverage', () => {
  it('joins locations, ingested entities and GitHub metadata into rows', async () => {
    const harness = renderCoverage({
      ...CARBON_ROWS,
      githubRepositories: [githubRepository('carbon'), githubRepository('salt', { primaryLanguage: 'Python' })],
    });

    await waitFor(() => expect(harness.latest().enrichmentPending).toBe(false));

    expect(harness.latest().rows).toEqual([
      expect.objectContaining({ repo: 'carbon', status: 'integrated', entityCount: 1, primaryLanguage: 'Java' }),
      expect.objectContaining({ repo: 'salt', status: 'not-integrated', entityCount: 0, primaryLanguage: 'Python' }),
    ]);
  });

  describe('staged loading', () => {
    it('never reports ingestion as loaded before the entities have arrived', async () => {
      const harness = renderCoverage({ ...CARBON_ROWS, githubRepositories: [githubRepository('carbon')] });

      await waitFor(() => expect(harness.latest().ingestionPending).toBe(false));

      // `useAsync` reports its dependent stage as idle for one render after the inventory lands, so
      // without an explicit settled check the KPI briefly renders as 100 % not integrated.
      const settled = harness.snapshots.filter(snapshot => !snapshot.ingestionPending);
      expect(settled).not.toHaveLength(0);
      for (const snapshot of settled) {
        expect(snapshot.rows.some(row => row.entityCount > 0)).toBe(true);
      }
    });

    it('never reports enrichment as loaded before the GitHub metadata has arrived', async () => {
      const harness = renderCoverage({ ...CARBON_ROWS, githubRepositories: [githubRepository('carbon')] });

      await waitFor(() => expect(harness.latest().enrichmentPending).toBe(false));

      const settled = harness.snapshots.filter(snapshot => !snapshot.enrichmentPending);
      expect(settled).not.toHaveLength(0);
      for (const snapshot of settled) {
        expect(snapshot.githubEnrichmentAvailable).toBe(true);
      }
    });

    it('reports the inventory as pending only while it is loading', async () => {
      const harness = renderCoverage({ ...CARBON_ROWS });

      expect(harness.snapshots[0].inventoryPending).toBe(true);
      await waitFor(() => expect(harness.latest().inventoryPending).toBe(false));
    });
  });

  describe('ingestion query', () => {
    it('chunks the origin filter so the request URL stays small', async () => {
      const locations = Array.from({ length: 120 }, (_unused, index) => locationEntity(`repo-${index}`, index));
      const harness = renderCoverage({ locations, children: [] });

      await waitFor(() => expect(harness.latest().ingestionPending).toBe(false));

      expect(harness.originFilters.map(refs => refs.length)).toEqual([50, 50, 20]);
      expect(new Set(harness.originFilters.flat()).size).toBe(120);
    });

    it('is skipped when the organization has no repositories at all', async () => {
      const harness = renderCoverage({ locations: [], children: [] });

      await waitFor(() => expect(harness.latest().ingestionPending).toBe(false));

      expect(harness.originFilters).toEqual([]);
      expect(harness.latest().rows).toEqual([]);
    });
  });

  describe('degraded GitHub enrichment', () => {
    it('surfaces the failure without breaking the catalog-only view', async () => {
      const harness = renderCoverage({ ...CARBON_ROWS, githubError: new Error('401 Unauthorized') });

      await waitFor(() => expect(harness.latest().enrichmentPending).toBe(false));

      const coverage = harness.latest();
      expect(coverage.enrichmentError?.message).toBe('401 Unauthorized');
      expect(coverage.githubEnrichmentAvailable).toBe(false);
      expect(coverage.error).toBeUndefined();
      // Uningested repositories become `unknown`, since drift can no longer be told apart.
      expect(coverage.rows.map(row => row.status)).toEqual(['integrated', 'unknown']);
      // No language is known, so the only selectable option is the explicit unknown sentinel.
      expect(coverage.languageOptions).toEqual([{ id: UNKNOWN_LANGUAGE, label: 'Unknown', repositoryCount: 2 }]);
    });
  });

  it('treats a failure to read the inventory as fatal', async () => {
    const harness = renderCoverage({ locations: [], children: [], inventoryError: new Error('catalog is down') });

    await waitFor(() => expect(harness.latest().error?.message).toBe('catalog is down'));

    expect(harness.latest().rows).toEqual([]);
  });

  it('counts the GitHub repositories the provider does not track', async () => {
    const harness = renderCoverage({
      ...CARBON_ROWS,
      githubRepositories: [githubRepository('carbon'), githubRepository('salt'), githubRepository('an-archived-fork')],
    });

    await waitFor(() => expect(harness.latest().enrichmentPending).toBe(false));

    expect(harness.latest().untrackedRepositoryCount).toBe(1);
  });

  it('drops the GitHub cache when the enrichment stage is refreshed', async () => {
    const harness = renderCoverage({ ...CARBON_ROWS, githubRepositories: [githubRepository('carbon')] });

    await waitFor(() => expect(harness.latest().enrichmentPending).toBe(false));
    act(() => harness.latest().refreshEnrichment());
    await waitFor(() => expect(harness.githubApi.listOrganizationRepositories).toHaveBeenCalledTimes(2));

    expect(harness.githubApi.invalidate).toHaveBeenCalledTimes(1);
  });
});
