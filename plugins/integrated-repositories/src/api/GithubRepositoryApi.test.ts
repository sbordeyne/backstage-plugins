import { FetchApi } from '@backstage/core-plugin-api';
import { ScmIntegrationRegistry } from '@backstage/integration';
import { ScmAuthApi } from '@backstage/integration-react';
import { GithubGraphqlRepositoryClient } from './GithubRepositoryApi';
import { OrganizationRef } from '../types';

const ORG_REF: OrganizationRef = { host: 'github.com', org: 'example-org' };

interface RepositoryNodeStub {
  name?: string;
  pushedAt?: string | null;
  primaryLanguage?: { name: string } | null;
  rootCatalogInfo?: { __typename: string } | null;
  isPrivate?: boolean;
}

function node(overrides: RepositoryNodeStub = {}): unknown {
  return {
    name: 'carbon',
    url: 'https://github.com/example-org/carbon',
    isPrivate: true,
    pushedAt: '2026-07-30T09:00:00Z',
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
}

function harness(options: { apiBaseUrl?: string | undefined; host?: string } = {}): Harness {
  const fetch = jest.fn();
  const fetchApi = { fetch } as unknown as FetchApi;

  const configuredHost = options.host ?? 'github.com';
  const scmIntegrations = {
    github: {
      byHost: (host: string) =>
        host === configuredHost
          ? { config: { host, apiBaseUrl: 'apiBaseUrl' in options ? options.apiBaseUrl : 'https://api.github.com' } }
          : undefined,
    },
  } as unknown as ScmIntegrationRegistry;

  const scmAuthApi = {
    getCredentials: async () => ({ token: 'secret', headers: { Authorization: 'Bearer secret' } }),
  } as unknown as ScmAuthApi;

  let clock = 1_000_000;
  const client = new GithubGraphqlRepositoryClient(scmAuthApi, scmIntegrations, fetchApi, () => clock);

  return {
    client,
    fetch,
    advance: milliseconds => {
      clock += milliseconds;
    },
    requestBody: call => JSON.parse(fetch.mock.calls[call][1].body),
    requestHeaders: call => fetch.mock.calls[call][1].headers,
  };
}

describe('GithubGraphqlRepositoryClient', () => {
  describe('pagination', () => {
    it('follows the cursor until the last page and concatenates the results', async () => {
      const { client, fetch, requestBody } = harness();
      fetch
        .mockResolvedValueOnce(jsonResponse(page([node({ name: 'carbon' })], 'CURSOR-1')))
        .mockResolvedValueOnce(jsonResponse(page([node({ name: 'salt' })])));

      const repositories = await client.listOrganizationRepositories(ORG_REF);

      expect(repositories.map(repository => repository.name)).toEqual(['carbon', 'salt']);
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(requestBody(0).variables).toEqual({ org: 'example-org', cursor: null });
      expect(requestBody(1).variables).toEqual({ org: 'example-org', cursor: 'CURSOR-1' });
    });

    it('passes the organization as a GraphQL variable rather than inlining it', async () => {
      const { client, fetch, requestBody } = harness();
      fetch.mockResolvedValue(jsonResponse(page([node()])));

      await client.listOrganizationRepositories(ORG_REF);

      expect(requestBody(0).query).not.toContain('example-org');
      expect(requestBody(0).query).toContain('$org: String!');
    });

    it('skips null nodes, which GraphQL returns for repositories it cannot resolve', async () => {
      const { client, fetch } = harness();
      fetch.mockResolvedValue(jsonResponse(page([null, node({ name: 'carbon' }), null])));

      await expect(client.listOrganizationRepositories(ORG_REF)).resolves.toHaveLength(1);
    });
  });

  describe('node mapping', () => {
    it('reads the fields the catalog cannot provide', async () => {
      const { client, fetch } = harness();
      fetch.mockResolvedValue(jsonResponse(page([node()])));

      const [repository] = await client.listOrganizationRepositories(ORG_REF);

      expect(repository).toEqual({
        name: 'carbon',
        url: 'https://github.com/example-org/carbon',
        isPrivate: true,
        pushedAt: '2026-07-30T09:00:00Z',
        primaryLanguage: 'Java',
        hasRootCatalogInfo: true,
      });
    });

    it('reports a missing root catalog-info.yaml, which is what tells drift apart', async () => {
      const { client, fetch } = harness();
      fetch.mockResolvedValue(jsonResponse(page([node({ rootCatalogInfo: null })])));

      const [repository] = await client.listOrganizationRepositories(ORG_REF);

      expect(repository.hasRootCatalogInfo).toBe(false);
    });

    it('normalises the nulls GraphQL uses for an empty repository', async () => {
      const { client, fetch } = harness();
      fetch.mockResolvedValue(jsonResponse(page([node({ pushedAt: null, primaryLanguage: null })])));

      const [repository] = await client.listOrganizationRepositories(ORG_REF);

      expect(repository.pushedAt).toBeUndefined();
      expect(repository.primaryLanguage).toBeUndefined();
    });
  });

  describe('caching', () => {
    it('serves a second call from the cache', async () => {
      const { client, fetch } = harness();
      fetch.mockResolvedValue(jsonResponse(page([node()])));

      await client.listOrganizationRepositories(ORG_REF);
      await client.listOrganizationRepositories(ORG_REF);

      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('goes back to GitHub once the entry has expired', async () => {
      const { client, fetch, advance } = harness();
      fetch.mockResolvedValue(jsonResponse(page([node()])));

      await client.listOrganizationRepositories(ORG_REF);
      advance(5 * 60 * 1000);
      await client.listOrganizationRepositories(ORG_REF);

      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('still serves from the cache just before the entry expires', async () => {
      const { client, fetch, advance } = harness();
      fetch.mockResolvedValue(jsonResponse(page([node()])));

      await client.listOrganizationRepositories(ORG_REF);
      advance(5 * 60 * 1000 - 1);
      await client.listOrganizationRepositories(ORG_REF);

      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('drops the cache on invalidate, which is what the Refresh button does', async () => {
      const { client, fetch } = harness();
      fetch.mockResolvedValue(jsonResponse(page([node()])));

      await client.listOrganizationRepositories(ORG_REF);
      client.invalidate();
      await client.listOrganizationRepositories(ORG_REF);

      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('keys the cache per host and organization', async () => {
      const { client, fetch } = harness();
      fetch.mockResolvedValue(jsonResponse(page([node()])));

      await client.listOrganizationRepositories(ORG_REF);
      await client.listOrganizationRepositories({ host: 'github.com', org: 'other-org' });

      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('endpoint resolution', () => {
    it('appends /graphql to the github.com API base URL', async () => {
      const { client, fetch } = harness();
      fetch.mockResolvedValue(jsonResponse(page([node()])));

      await client.listOrganizationRepositories(ORG_REF);

      expect(fetch).toHaveBeenCalledWith('https://api.github.com/graphql', expect.anything());
    });

    it('drops the REST version segment for GitHub Enterprise Server hosts', async () => {
      const { client, fetch } = harness({ host: 'ghe.example.com', apiBaseUrl: 'https://ghe.example.com/api/v3' });
      fetch.mockResolvedValue(jsonResponse(page([node()])));

      await client.listOrganizationRepositories({ host: 'ghe.example.com', org: 'example-org' });

      expect(fetch).toHaveBeenCalledWith('https://ghe.example.com/api/graphql', expect.anything());
    });

    it('tolerates a trailing slash on the configured API base URL', async () => {
      const { client, fetch } = harness({ host: 'ghe.example.com', apiBaseUrl: 'https://ghe.example.com/api/v3/' });
      fetch.mockResolvedValue(jsonResponse(page([node()])));

      await client.listOrganizationRepositories({ host: 'ghe.example.com', org: 'example-org' });

      expect(fetch).toHaveBeenCalledWith('https://ghe.example.com/api/graphql', expect.anything());
    });

    it('falls back to the conventional API subdomain when the integration declares no base URL', async () => {
      const { client, fetch } = harness({ apiBaseUrl: undefined });
      fetch.mockResolvedValue(jsonResponse(page([node()])));

      await client.listOrganizationRepositories(ORG_REF);

      expect(fetch).toHaveBeenCalledWith('https://api.github.com/graphql', expect.anything());
    });

    it('fails loudly when the host has no configured integration', async () => {
      const { client, fetch } = harness();

      await expect(client.listOrganizationRepositories({ host: 'gitlab.com', org: 'example-org' })).rejects.toThrow(
        "No GitHub integration is configured for host 'gitlab.com'",
      );
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe('authentication', () => {
    it('sends the credentials scmAuth resolved for the organization', async () => {
      const { client, fetch, requestHeaders } = harness();
      fetch.mockResolvedValue(jsonResponse(page([node()])));

      await client.listOrganizationRepositories(ORG_REF);

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

      await expect(client.listOrganizationRepositories(ORG_REF)).rejects.toThrow(
        "GitHub GraphQL request for organization 'example-org' failed with 401",
      );
    });

    it('reports GraphQL errors returned alongside a 200', async () => {
      const { client, fetch } = harness();
      fetch.mockResolvedValue(
        jsonResponse({ errors: [{ message: 'Resource protected by organization SAML enforcement' }] }),
      );

      await expect(client.listOrganizationRepositories(ORG_REF)).rejects.toThrow(
        'Resource protected by organization SAML enforcement',
      );
    });

    it('reports an organization the credentials cannot see', async () => {
      const { client, fetch } = harness();
      fetch.mockResolvedValue(jsonResponse({ data: { organization: null } }));

      await expect(client.listOrganizationRepositories(ORG_REF)).rejects.toThrow(
        "Organization 'example-org' was not found or is not accessible with the current credentials",
      );
    });

    it('does not cache a failure', async () => {
      const { client, fetch } = harness();
      fetch.mockResolvedValueOnce(jsonResponse({}, 500)).mockResolvedValueOnce(jsonResponse(page([node()])));

      await expect(client.listOrganizationRepositories(ORG_REF)).rejects.toThrow('failed with 500');

      await expect(client.listOrganizationRepositories(ORG_REF)).resolves.toHaveLength(1);
    });
  });
});
