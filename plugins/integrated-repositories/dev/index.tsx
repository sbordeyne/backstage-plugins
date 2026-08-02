import { createDevApp } from '@backstage/dev-utils';
import { TestApiProvider, wrapInTestApp } from '@backstage/test-utils';
import { ANNOTATION_LOCATION, ANNOTATION_ORIGIN_LOCATION, Entity } from '@backstage/catalog-model';
import { CatalogApi, catalogApiRef } from '@backstage/plugin-catalog-react';
import {
  GithubRepositoryApi,
  githubRepositoryApiRef,
  GithubRepositoryInfo,
  IntegratedRepositoriesPage,
  integratedRepositoriesPlugin,
} from '../src';

const ORG = 'example-org';

interface MockRepository {
  repo: string;
  language?: string;
  pushedAt: string;
  /** Resolved catalog-info.yaml paths; empty means nothing was ingested. */
  paths: string[];
  hasRootCatalogInfo: boolean;
}

const MOCK_REPOSITORIES: MockRepository[] = [
  {
    repo: 'example-users',
    language: 'Java',
    pushedAt: '2026-07-29T09:00:00Z',
    paths: ['catalog-info.yaml'],
    hasRootCatalogInfo: true,
  },
  {
    repo: 'example-notifications',
    language: 'Java',
    pushedAt: '2026-07-27T09:00:00Z',
    paths: [],
    hasRootCatalogInfo: false,
  },
  {
    repo: 'example-payments',
    language: 'Kotlin',
    pushedAt: '2026-07-20T09:00:00Z',
    paths: [],
    hasRootCatalogInfo: false,
  },
  {
    repo: 'backend',
    language: 'Java',
    pushedAt: '2026-07-26T09:00:00Z',
    paths: ['services/users/catalog-info.yaml', 'services/search/catalog-info.yaml'],
    hasRootCatalogInfo: false,
  },
  {
    repo: 'docker',
    language: 'Shell',
    pushedAt: '2026-07-25T09:00:00Z',
    paths: ['images/catalog-info.yaml'],
    hasRootCatalogInfo: false,
  },
  { repo: 'ios', language: 'Swift', pushedAt: '2025-11-02T09:00:00Z', paths: [], hasRootCatalogInfo: false },
];

function globTarget(repo: string): string {
  return `https://github.com/${ORG}/${repo}/blob/master/**/catalog-info.yaml`;
}

function locationEntity(repo: string, index: number): Entity {
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Location',
    metadata: {
      name: `generated-${index}`,
      annotations: {
        [ANNOTATION_LOCATION]: `url:${globTarget(repo)}`,
        [ANNOTATION_ORIGIN_LOCATION]: `url:${globTarget(repo)}`,
      },
    },
    spec: { type: 'url', target: globTarget(repo), presence: 'optional' },
  };
}

function childEntity(repo: string, path: string, index: number): Entity {
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: {
      name: `${repo}-${index}`,
      annotations: {
        [ANNOTATION_LOCATION]: `url:https://github.com/${ORG}/${repo}/tree/master/${path}`,
        [ANNOTATION_ORIGIN_LOCATION]: `url:${globTarget(repo)}`,
      },
    },
    spec: { type: 'service' },
  };
}

const LOCATION_ENTITIES = MOCK_REPOSITORIES.map((mock, index) => locationEntity(mock.repo, index));

const CHILD_ENTITIES = MOCK_REPOSITORIES.flatMap(mock =>
  mock.paths.map((path, index) => childEntity(mock.repo, path, index)),
);

const GITHUB_REPOSITORIES: GithubRepositoryInfo[] = MOCK_REPOSITORIES.map(mock => ({
  name: mock.repo,
  url: `https://github.com/${ORG}/${mock.repo}`,
  isPrivate: true,
  pushedAt: mock.pushedAt,
  primaryLanguage: mock.language,
  hasRootCatalogInfo: mock.hasRootCatalogInfo,
}));

function isLocationQuery(filter: unknown): boolean {
  return !Array.isArray(filter) && typeof filter === 'object' && filter !== null && 'kind' in filter;
}

// Only `getEntities` is exercised by the page, so the rest of CatalogApi is left unimplemented.
const mockCatalogApi = {
  async getEntities(request?: { filter?: unknown }) {
    return { items: isLocationQuery(request?.filter) ? LOCATION_ENTITIES : CHILD_ENTITIES };
  },
} as unknown as CatalogApi;

/** Simulates the sequential GraphQL pages so the staged loading is actually observable. */
function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds);
  });
}

const mockGithubApi: GithubRepositoryApi = {
  async listOrganizationRepositories() {
    await delay(1500);
    return GITHUB_REPOSITORIES;
  },
  invalidate() {},
};

const failingGithubApi: GithubRepositoryApi = {
  async listOrganizationRepositories() {
    await delay(1500);
    throw new Error("GitHub GraphQL request for organization 'example-org' failed with 401");
  },
  invalidate() {},
};

function renderPage(githubApi: GithubRepositoryApi): JSX.Element {
  return wrapInTestApp(
    <TestApiProvider
      apis={[
        [catalogApiRef, mockCatalogApi],
        [githubRepositoryApiRef, githubApi],
      ]}
    >
      <IntegratedRepositoriesPage />
    </TestApiProvider>,
  );
}

createDevApp()
  .registerPlugin(integratedRepositoriesPlugin)
  .addPage({
    element: renderPage(mockGithubApi),
    title: 'Integrated Repositories',
    path: '/integrated-repositories',
  })
  .addPage({
    element: renderPage(failingGithubApi),
    title: 'Degraded (no GitHub)',
    path: '/integrated-repositories-degraded',
  })
  .render();
