import { createApiRef, FetchApi } from '@backstage/core-plugin-api';
import { ScmIntegrationRegistry } from '@backstage/integration';
import { ScmAuthApi } from '@backstage/integration-react';
import { GithubRepositoryInfo, OrganizationRef } from '../types';

/** Reads the repository metadata the catalog cannot provide: language, recency, and file presence. */
export interface GithubRepositoryApi {
  listOrganizationRepositories(organization: OrganizationRef): Promise<GithubRepositoryInfo[]>;
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

const REPOSITORY_PAGE_SIZE = 100;

/**
 * `rootCatalogInfo` resolves to a blob only when `catalog-info.yaml` exists at the root of the
 * default branch. It rides along in this query so drift detection costs no extra requests.
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
        pushedAt
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
  pushedAt: string | null;
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

function toRepositoryInfo(node: RepositoryNode): GithubRepositoryInfo {
  return {
    name: node.name,
    url: node.url,
    isPrivate: node.isPrivate,
    pushedAt: node.pushedAt ?? undefined,
    primaryLanguage: node.primaryLanguage?.name,
    hasRootCatalogInfo: node.rootCatalogInfo !== null,
  };
}

export class GithubGraphqlRepositoryClient implements GithubRepositoryApi {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly scmAuthApi: ScmAuthApi,
    private readonly scmIntegrations: ScmIntegrationRegistry,
    private readonly fetchApi: FetchApi,
    private readonly now: () => number = () => Date.now(),
  ) {}

  invalidate(): void {
    this.cache.clear();
  }

  async listOrganizationRepositories(organization: OrganizationRef): Promise<GithubRepositoryInfo[]> {
    const cacheKey = `${organization.host}/${organization.org}`;
    const cached = this.cache.get(cacheKey);
    if (cached && this.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.repositories;
    }

    const repositories = await this.fetchAllPages(organization);
    this.cache.set(cacheKey, { fetchedAt: this.now(), repositories });
    return repositories;
  }

  private async fetchAllPages(organization: OrganizationRef): Promise<GithubRepositoryInfo[]> {
    const endpoint = this.resolveGraphqlEndpoint(organization.host);
    const headers = await this.resolveAuthHeaders(organization);

    const repositories: GithubRepositoryInfo[] = [];
    let cursor: string | undefined;

    do {
      const page = await this.fetchPage(endpoint, headers, organization.org, cursor);
      for (const node of page.nodes) {
        if (node) {
          repositories.push(toRepositoryInfo(node));
        }
      }
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor ?? undefined : undefined;
    } while (cursor);

    return repositories;
  }

  /**
   * Derived from the integration rather than hardcoded, so GitHub Enterprise Server hosts work.
   *
   * The integration only carries a REST base URL. On github.com that is `https://api.github.com`
   * and appending `/graphql` is enough, but Enterprise Server serves REST under `<host>/api/v3`
   * while GraphQL lives at `<host>/api/graphql` — one segment up. Dropping a trailing `/v3` turns
   * one into the other.
   */
  private resolveGraphqlEndpoint(host: string): string {
    const integration = this.scmIntegrations.github.byHost(host);
    if (!integration) {
      throw new Error(`No GitHub integration is configured for host '${host}'`);
    }
    const apiBaseUrl = (integration.config.apiBaseUrl ?? `https://api.${host}`).replace(/\/+$/, '');
    return `${apiBaseUrl.replace(/\/v3$/, '')}/graphql`;
  }

  private async resolveAuthHeaders(organization: OrganizationRef): Promise<Record<string, string>> {
    const { headers } = await this.scmAuthApi.getCredentials({
      url: `https://${organization.host}/${organization.org}`,
    });
    return headers;
  }

  private async fetchPage(
    endpoint: string,
    headers: Record<string, string>,
    org: string,
    cursor: string | undefined,
  ): Promise<RepositoryPage> {
    const response = await this.fetchApi.fetch(endpoint, {
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
