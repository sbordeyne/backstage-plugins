import { FetchApi } from '@backstage/core-plugin-api';
import { ScmAuthApi } from '@backstage/integration-react';
import { GithubGraphqlRepositoryClient } from './GithubRepositoryApi';

const ORG = 'happn-app';

interface RepositoryNodeStub {
  name?: string;
  pushedAt?: string | null;
  owner?: { login: string } | null;
  defaultBranchRef?: { name: string } | null;
  primaryLanguage?: { name: string } | null;
  rootCatalogInfo?: { __typename: string } | null;
  isPrivate?: boolean;
  isArchived?: boolean;
  isFork?: boolean;
}

function node(overrides: RepositoryNodeStub = {}): unknown {
  return {
    name: 'carbon',
    url: `https://github.com/${ORG}/carbon`,
    isPrivate: true,
    isArchived: false,
    isFork: false,
    pushedAt: '2026-07-30T09:00:00Z',
    owner: { login: ORG },
    defaultBranchRef: { name: 'master' },
    primaryLanguage: { name: 'Java' },
    rootCatalogInfo: { __typename: 'Blob' },
    ...overrides,
  };
}

function page(nodes: unknown[], endCursor: string | null = null): unknown {
  return {
    data: {
      organization: {
        repositories: { pageInfo: { hasNextPage: endCursor !== null, endCursor }, nodes },
      },
    },
  };
}

function jsonResponse(payload: unknown, status: number = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => payload } as Response;
}

interface Harness {
  client: GithubGraphqlRepositoryClient;
  fetch: jest.Mock;
  /** Advances the clock the client reads its cache timestamps from. */
  advance: (milliseconds: number) => void;
  requestBody: (call: number) => { query: string; variables: { org: string; cursor: string | null } };
  requestHeaders: (call: number) => Record<string, string>;
  credentialUrls: string[];
}

function harness(options: { organization?: string | undefined } = {}): Harness {
  const fetch = jest.fn();
  const fetchApi = { fetch } as unknown as FetchApi;
  const credentialUrls: string[] = [];

  const scmAuthApi = {
    getCredentials: async ({ url }: { url: string }) => {
      credentialUrls.push(url);
      return { token: 'secret', headers: { Authorization: 'Bearer secret' } };
    },
  } as unknown as ScmAuthApi;

  let clock = 1_000_000;
  const organization = 'organization' in options ? options.organization : ORG;
  const client = new GithubGraphqlRepositoryClient(scmAuthApi, fetchApi, organization, () => clock);

  return {
    client,
    fetch,
    advance: milliseconds => {
      clock += milliseconds;
    },
    requestBody: call => JSON.parse(fetch.mock.calls[call][1].body),
    requestHeaders: call => fetch.mock.calls[call][1].headers,
    credentialUrls,
  };
}

describe('GithubGraphqlRepositoryClient', () => {
  describe('pagination', () => {
    it('follows the cursor until the last page and concatenates the results', async () => {
      const { client, fetch, requestBody } = harness();
      fetch
        .mockResolvedValueOnce(jsonResponse(page([node({ name: 'carbon' })], 'CURSOR-1')))
        .mockResolvedValueOnce(jsonResponse(page([node({ name: 'salt' })])));

      const repositories = await client.listOrganizationRepositories();

      expect(repositories.map(repository => repository.name)).toEqual(['carbon', 'salt']);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(requestBody(0).variables).toEqual({ org: ORG, cursor: null });
      expect(requestBody(1).variables).toEqual({ org: ORG, cursor: 'CURSOR-1' });
    });

    it('passes the organization as a GraphQL variable rather than inlining it', async () => {
      const { client, fetch, requestBody } = harness();
      fetch.mockResolvedValue(jsonResponse(page([node()])));

      await client.listOrganizationRepositories();

      expect(requestBody(0).query).not.toContain(ORG);
      expect(requestBody(0).query).toContain('$org: String!');
    });

    it('skips null nodes, which GraphQL returns for repositories it cannot resolve', async () => {
      const { client, fetch } = harness();
      fetch.mockResolvedValue(jsonResponse(page([null, node({ name: 'carbon' }), null])));

      await expect(client.listOrganizationRepositories()).resolves.toHaveLength(1);
    });
  });

  describe('node mapping', () => {
    it('reads the fields the catalog cannot provide', async () => {
      const { client, fetch } = harness();
      fetch.mockResolvedValue(jsonResponse(page([node()])));

      const [repository] = await client.listOrganizationRepositories();

      expect(repository).toEqual({
        name: 'carbon',
        owner: ORG,
        url: `https://github.com/${ORG}/carbon`,
        isPrivate: true,
        isArchived: false,
        isFork: false,
        defaultBranch: 'master',
        hasDefaultBranch: true,
        pushedAt: '2026-07-30T09:00:00Z',
        primaryLanguage: 'Java',
        hasRootCatalogInfo: true,
      });
    });

    it('reads the three flags that explain a repository the catalog provider skips', async () => {
      const { client, fetch } = harness();
      fetch.mockResolvedValue(jsonResponse(page([node({ isArchived: true, isFork: true, defaultBranchRef: null })])));

      const [repository] = await client.listOrganizationRepositories();

      expect(repository).toMatchObject({ isArchived: true, isFork: true, hasDefaultBranch: false });
      expect(repository.defaultBranch).toBeUndefined();
    });

    it('falls back to the queried organization when GraphQL omits the owner', async () => {
      const { client, fetch } = harness();
      fetch.mockResolvedValue(jsonResponse(page([node({ owner: null })])));

      const [repository] = await client.listOrganizationRepositories();

      expect(repository.owner).toBe(ORG);
    });

    it('reports a missing root catalog-info.yaml, which is what tells drift apart', async () => {
      const { client, fetch } = harness();
      fetch.mockResolvedValue(jsonResponse(page([node({ rootCatalogInfo: null })])));

      const [repository] = await client.listOrganizationRepositories();

      expect(repository.hasRootCatalogInfo).toBe(false);
    });

    it('normalises the nulls GraphQL uses for an empty repository', async () => {
      const { client, fetch } = harness();
      fetch.mockResolvedValue(jsonResponse(page([node({ pushedAt: null, primaryLanguage: null })])));

      const [repository] = await client.listOrganizationRepositories();

      expect(repository.pushedAt).toBeUndefined();
      expect(repository.primaryLanguage).toBeUndefined();
    });
  });

  describe('caching', () => {
    it('serves a second call from the cache', async () => {
      const { client, fetch } = harness();
      fetch.mockResolvedValue(jsonResponse(page([node()])));

      await client.listOrganizationRepositories();
      await client.listOrganizationRepositories();

      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('goes back to GitHub once the entry has expired', async () => {
      const { client, fetch, advance } = harness();
      fetch.mockResolvedValue(jsonResponse(page([node()])));

      await client.listOrganizationRepositories();
      advance(5 * 60 * 1000);
      await client.listOrganizationRepositories();

      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('still serves from the cache just before the entry expires', async () => {
      const { client, fetch, advance } = harness();
      fetch.mockResolvedValue(jsonResponse(page([node()])));

      await client.listOrganizationRepositories();
      advance(5 * 60 * 1000 - 1);
      await client.listOrganizationRepositories();

      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('drops the cache on invalidate, which is what the Refresh button does', async () => {
      const { client, fetch } = harness();
      fetch.mockResolvedValue(jsonResponse(page([node()])));

      await client.listOrganizationRepositories();
      client.invalidate();
      await client.listOrganizationRepositories();

      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('concurrent calls', () => {
    it('shares one pagination between callers that overlap', async () => {
      const { client, fetch } = harness();
      fetch
        .mockResolvedValueOnce(jsonResponse(page([node({ name: 'carbon' })], 'CURSOR-1')))
        .mockResolvedValueOnce(jsonResponse(page([node({ name: 'salt' })])));

      const [first, second] = await Promise.all([
        client.listOrganizationRepositories(),
        client.listOrganizationRepositories(),
      ]);

      expect(first).toBe(second);
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('lets both callers retry after a shared run failed', async () => {
      const { client, fetch } = harness();
      fetch.mockResolvedValueOnce(jsonResponse({}, 500)).mockResolvedValueOnce(jsonResponse(page([node()])));

      const results = await Promise.allSettled([
        client.listOrganizationRepositories(),
        client.listOrganizationRepositories(),
      ]);

      expect(results.map(result => result.status)).toEqual(['rejected', 'rejected']);
      await expect(client.listOrganizationRepositories()).resolves.toHaveLength(1);
    });

    it('does not let a run started before invalidate populate the cache', async () => {
      const { client, fetch } = harness();
      fetch
        .mockResolvedValueOnce(jsonResponse(page([node({ name: 'stale' })])))
        .mockResolvedValueOnce(jsonResponse(page([node({ name: 'fresh' })])));

      const stale = client.listOrganizationRepositories();
      client.invalidate();
      await stale;

      await expect(client.listOrganizationRepositories()).resolves.toEqual([
        expect.objectContaining({ name: 'fresh' }),
      ]);
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('configuration', () => {
    it('queries the github.com GraphQL endpoint', async () => {
      const { client, fetch } = harness();
      fetch.mockResolvedValue(jsonResponse(page([node()])));

      await client.listOrganizationRepositories();

      expect(fetch).toHaveBeenCalledWith('https://api.github.com/graphql', expect.anything());
    });

    it('names the missing config key when no organization is configured', async () => {
      const { client, fetch } = harness({ organization: undefined });

      await expect(client.listOrganizationRepositories()).rejects.toThrow(
        'No GitHub organization is configured under `integratedRepositories.organization`',
      );
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('authentication', () => {
    it('sends the credentials scmAuth resolved for the organization', async () => {
      const { client, fetch, requestHeaders, credentialUrls } = harness();
      fetch.mockResolvedValue(jsonResponse(page([node()])));

      await client.listOrganizationRepositories();

      expect(credentialUrls).toEqual([`https://github.com/${ORG}`]);
      expect(requestHeaders(0)).toEqual({
        Authorization: 'Bearer secret',
        'Content-Type': 'application/json',
      });
    });
  });

  describe('failures', () => {
    it('reports the status of a rejected request', async () => {
      const { client, fetch } = harness();
      fetch.mockResolvedValue(jsonResponse({}, 401));

      await expect(client.listOrganizationRepositories()).rejects.toThrow(
        `GitHub GraphQL request for organization '${ORG}' failed with 401`,
      );
    });

    it('reports GraphQL errors returned alongside a 200', async () => {
      const { client, fetch } = harness();
      fetch.mockResolvedValue(
        jsonResponse({ errors: [{ message: 'Resource protected by organization SAML enforcement' }] }),
      );

      await expect(client.listOrganizationRepositories()).rejects.toThrow(
        'Resource protected by organization SAML enforcement',
      );
    });

    it('reports an organization the credentials cannot see', async () => {
      const { client, fetch } = harness();
      fetch.mockResolvedValue(jsonResponse({ data: { organization: null } }));

      await expect(client.listOrganizationRepositories()).rejects.toThrow(
        `Organization '${ORG}' was not found or is not accessible with the current credentials`,
      );
    });

    it('does not cache a failure', async () => {
      const { client, fetch } = harness();
      fetch.mockResolvedValueOnce(jsonResponse({}, 500)).mockResolvedValueOnce(jsonResponse(page([node()])));

      await expect(client.listOrganizationRepositories()).rejects.toThrow('failed with 500');

      await expect(client.listOrganizationRepositories()).resolves.toHaveLength(1);
    });
  });
});
