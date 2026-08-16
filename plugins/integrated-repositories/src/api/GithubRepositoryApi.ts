import { createApiRef, FetchApi } from '@backstage/core-plugin-api';
import { ScmAuthApi } from '@backstage/integration-react';
import { GithubRepositoryInfo } from '../types';

/** Reads the repository metadata the catalog cannot provide: language, recency, and file presence. */
export interface GithubRepositoryApi {
  listOrganizationRepositories(): Promise<GithubRepositoryInfo[]>;
  /** Drops any cached response so the next call goes back to GitHub. */
  invalidate(): void;
}

/**
 * Enumerating an organization costs one GraphQL round trip per 100 repositories, and those pages are
 * necessarily sequential. Caching for a few minutes makes navigating away and back instant while
 * keeping the weekly coverage figure fresh.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  fetchedAt: number;
  repositories: GithubRepositoryInfo[];
}

export const githubRepositoryApiRef = createApiRef<GithubRepositoryApi>({
  id: 'plugin.integrated-repositories.github',
});

const GITHUB_GRAPHQL_ENDPOINT = 'https://api.github.com/graphql';
const GITHUB_HOST = 'github.com';

const REPOSITORY_PAGE_SIZE = 100;

/**
 * `rootCatalogInfo` resolves to a blob only when `catalog-info.yaml` exists at the root of the
 * default branch. It rides along in this query so drift detection costs no extra requests.
 *
 * `isArchived`, `isFork` and a missing `defaultBranchRef` are the three the catalog provider skips, so
 * they are what explains a repository that GitHub reports but the catalog has no `Location` for.
 *
 * `owner` is what gives such a repository its organization, since it has no `Location` to read one from.
 */
const ORGANIZATION_REPOSITORIES_QUERY = `query OrgRepos($org: String!, $cursor: String) {
  organization(login: $org) {
    repositories(first: ${REPOSITORY_PAGE_SIZE}, after: $cursor, orderBy: { field: PUSHED_AT, direction: DESC }) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        name
        url
        isPrivate
        isArchived
        isFork
        pushedAt
        owner {
          login
        }
        defaultBranchRef {
          name
        }
        primaryLanguage {
          name
        }
        rootCatalogInfo: object(expression: "HEAD:catalog-info.yaml") {
          __typename
        }
      }
    }
  }
}`;

interface RepositoryNode {
  name: string;
  url: string;
  isPrivate: boolean;
  isArchived: boolean;
  isFork: boolean;
  pushedAt: string | null;
  owner: { login: string } | null;
  defaultBranchRef: { name: string } | null;
  primaryLanguage: { name: string } | null;
  rootCatalogInfo: { __typename: string } | null;
}

interface RepositoryPage {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: (RepositoryNode | null)[];
}

interface GraphqlResponse {
  data?: { organization?: { repositories: RepositoryPage } | null } | null;
  errors?: { message: string }[];
}

function toRepositoryInfo(node: RepositoryNode, org: string): GithubRepositoryInfo {
  return {
    name: node.name,
    // The query is scoped to one organization, so that is the owner of everything it returns.
    owner: node.owner?.login ?? org,
    url: node.url,
    isPrivate: node.isPrivate,
    isArchived: node.isArchived,
    isFork: node.isFork,
    defaultBranch: node.defaultBranchRef?.name ?? undefined,
    hasDefaultBranch: node.defaultBranchRef !== null,
    pushedAt: node.pushedAt ?? undefined,
    primaryLanguage: node.primaryLanguage?.name,
    hasRootCatalogInfo: node.rootCatalogInfo !== null,
  };
}

export class GithubGraphqlRepositoryClient implements GithubRepositoryApi {
  private cache: CacheEntry | undefined;
  /**
   * The run in flight, so concurrent callers share one pagination instead of each starting their
   * own. Two mounts of the page — or React's development double-effect — would otherwise walk every
   * GraphQL page twice before the first result reaches the cache.
   */
  private inFlight: Promise<GithubRepositoryInfo[]> | undefined;
  /** Bumped by {@link invalidate}, so a run started before it can neither be joined nor cached. */
  private generation = 0;

  constructor(
    private readonly scmAuthApi: ScmAuthApi,
    private readonly fetchApi: FetchApi,
    /** Undefined when `integratedRepositories.organization` is not configured. */
    private readonly organization: string | undefined,
    private readonly now: () => number = () => Date.now(),
  ) {}

  invalidate(): void {
    this.cache = undefined;
    this.inFlight = undefined;
    this.generation += 1;
  }

  async listOrganizationRepositories(): Promise<GithubRepositoryInfo[]> {
    const org = this.organization;
    if (!org) {
      throw new Error('No GitHub organization is configured under `integratedRepositories.organization`');
    }

    if (this.cache && this.now() - this.cache.fetchedAt < CACHE_TTL_MS) {
      return this.cache.repositories;
    }

    if (!this.inFlight) {
      const generation = this.generation;
      // A rejected run is not cached, so the next caller retries rather than inheriting the failure.
      this.inFlight = this.fetchAllPages(org)
        .then(repositories => {
          if (generation === this.generation) {
            this.cache = { fetchedAt: this.now(), repositories };
            this.inFlight = undefined;
          }
          return repositories;
        })
        .catch(error => {
          if (generation === this.generation) {
            this.inFlight = undefined;
          }
          throw error;
        });
    }

    return this.inFlight;
  }

  private async fetchAllPages(org: string): Promise<GithubRepositoryInfo[]> {
    const headers = await this.resolveAuthHeaders(org);

    const repositories: GithubRepositoryInfo[] = [];
    let cursor: string | undefined;

    do {
      const page = await this.fetchPage(headers, org, cursor);
      for (const node of page.nodes) {
        if (node) {
          repositories.push(toRepositoryInfo(node, org));
        }
      }
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor ?? undefined : undefined;
    } while (cursor);

    return repositories;
  }

  private async resolveAuthHeaders(org: string): Promise<Record<string, string>> {
    const { headers } = await this.scmAuthApi.getCredentials({ url: `https://${GITHUB_HOST}/${org}` });
    return headers;
  }

  private async fetchPage(
    headers: Record<string, string>,
    org: string,
    cursor: string | undefined,
  ): Promise<RepositoryPage> {
    const response = await this.fetchApi.fetch(GITHUB_GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: ORGANIZATION_REPOSITORIES_QUERY, variables: { org, cursor: cursor ?? null } }),
    });

    if (!response.ok) {
      throw new Error(`GitHub GraphQL request for organization '${org}' failed with ${response.status}`);
    }

    const payload: GraphqlResponse = await response.json();
    if (payload.errors?.length) {
      throw new Error(
        `GitHub GraphQL request for organization '${org}' returned errors: ${payload.errors
          .map(error => error.message)
          .join('; ')}`,
      );
    }

    const repositories = payload.data?.organization?.repositories;
    if (!repositories) {
      throw new Error(`Organization '${org}' was not found or is not accessible with the current credentials`);
    }

    return repositories;
  }
}
