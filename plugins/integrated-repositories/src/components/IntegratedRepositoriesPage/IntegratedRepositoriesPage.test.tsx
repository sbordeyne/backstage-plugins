import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ANNOTATION_LOCATION, ANNOTATION_ORIGIN_LOCATION, Entity } from '@backstage/catalog-model';
import { alertApiRef, configApiRef } from '@backstage/core-plugin-api';
import { CatalogApi, catalogApiRef } from '@backstage/plugin-catalog-react';
import { JsonObject } from '@backstage/types';
import { mockApis, renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { IntegratedRepositoriesPage } from './IntegratedRepositoriesPage';
import { GithubRepositoryApi, githubRepositoryApiRef } from '../../api';
import { selectedTemplateRouteRef } from '../../routes';
import { GithubRepositoryInfo } from '../../types';

const ORG = 'happn-app';
const WIZARD_PATH = '/create/templates/:namespace/:templateName';

function target(repo: string): string {
  return `https://github.com/${ORG}/${repo}/blob/master/**/catalog-info.yaml`;
}

function locationEntity(repo: string, index: number): Entity {
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Location',
    metadata: { name: `generated-${index}`, annotations: { [ANNOTATION_ORIGIN_LOCATION]: `url:${target(repo)}` } },
    spec: { type: 'url', target: target(repo), presence: 'optional' },
  } as Entity;
}

function componentEntity(repo: string): Entity {
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: {
      name: repo,
      annotations: {
        [ANNOTATION_LOCATION]: `url:https://github.com/${ORG}/${repo}/tree/master/catalog-info.yaml`,
        [ANNOTATION_ORIGIN_LOCATION]: `url:${target(repo)}`,
      },
    },
  } as Entity;
}

function githubRepository(repo: string, overrides: Partial<GithubRepositoryInfo> = {}): GithubRepositoryInfo {
  return {
    name: repo,
    url: `https://github.com/${ORG}/${repo}`,
    owner: ORG,
    isPrivate: true,
    isArchived: false,
    isFork: false,
    hasDefaultBranch: true,
    pushedAt: '2026-07-30T00:00:00Z',
    primaryLanguage: 'Java',
    hasRootCatalogInfo: false,
    ...overrides,
  };
}

/** carbon is integrated, salt is not, happn-payments is not and is Kotlin. */
const LOCATIONS = [locationEntity('carbon', 0), locationEntity('salt', 1), locationEntity('happn-payments', 2)];
const CHILDREN = [componentEntity('carbon')];
const GITHUB_REPOSITORIES = [
  githubRepository('carbon'),
  githubRepository('salt', { primaryLanguage: 'Python' }),
  githubRepository('happn-payments', { primaryLanguage: 'Kotlin' }),
];

/** The same organization, plus the repository the provider skips and emits no `Location` for. */
const WITH_ARCHIVED = [...GITHUB_REPOSITORIES, githubRepository('happn-legacy', { isArchived: true })];

const BASE_CONFIG: JsonObject = { integratedRepositories: { organization: ORG } };

interface Scenario {
  config?: JsonObject;
  githubRepositories?: GithubRepositoryInfo[];
  githubError?: Error;
  inventoryError?: Error;
}

/** The inventory stage is the only one that filters on `kind`. */
function isInventoryQuery(filter: unknown): boolean {
  return typeof filter === 'object' && filter !== null && !Array.isArray(filter) && 'kind' in filter;
}

async function renderPage(scenario: Scenario = {}) {
  const catalogApi = {
    async getEntities(request?: { filter?: unknown }) {
      if (isInventoryQuery(request?.filter)) {
        if (scenario.inventoryError) {
          throw scenario.inventoryError;
        }
        return { items: LOCATIONS };
      }
      return { items: CHILDREN };
    },
  } as unknown as CatalogApi;

  const githubApi: GithubRepositoryApi = {
    listOrganizationRepositories: jest.fn(async () => {
      if (scenario.githubError) {
        throw scenario.githubError;
      }
      return scenario.githubRepositories ?? GITHUB_REPOSITORIES;
    }),
    invalidate: jest.fn(),
  };

  await renderInTestApp(
    <TestApiProvider
      apis={[
        [catalogApiRef, catalogApi],
        [githubRepositoryApiRef, githubApi],
        [alertApiRef, { post: jest.fn(), alert$: jest.fn() }],
        [configApiRef, mockApis.config({ data: scenario.config ?? BASE_CONFIG })],
      ]}
    >
      <IntegratedRepositoriesPage />
    </TestApiProvider>,
    { mountedRoutes: { [WIZARD_PATH]: selectedTemplateRouteRef } },
  );

  return { githubApi };
}

/** The repository name is rendered as the first link of each table row. */
function tabledRepositories(): string[] {
  return screen
    .getAllByRole('row')
    .slice(1)
    .map(row => within(row).getAllByRole('link')[0]?.textContent ?? '');
}

function tableRowFor(repo: string): HTMLElement {
  const found = screen
    .getAllByRole('row')
    .slice(1)
    .find(row => within(row).getAllByRole('link')[0]?.textContent === repo);

  if (!found) {
    throw new Error(`No table row rendered for repository '${repo}'`);
  }
  return found;
}

/**
 * Adds a repository kind to the perimeter.
 *
 * The listbox stays open after a pick, since the control is a multi-select, and while it is open the
 * rest of the page is `aria-hidden` — so it has to be dismissed before anything else can be queried.
 */
async function selectKind(user: ReturnType<typeof userEvent.setup>, name: RegExp): Promise<void> {
  await user.click(screen.getByRole('button', { name: /repository kinds/i }));
  await user.click(screen.getByRole('option', { name }));
  await user.keyboard('{Escape}');
}

/**
 * How many links carry this repository name. The table renders one per repository, so a second one
 * is the worklist suggestion.
 */
function linkCount(repo: string): number {
  return screen.queryAllByRole('link', { name: repo }).length;
}

describe('IntegratedRepositoriesPage', () => {
  it('names the organization in the subtitle', async () => {
    await renderPage();

    expect(screen.getByText(`Coverage of integrated repositories of the ${ORG} GitHub organization`)).toBeVisible();
  });

  it('falls back to a generic subtitle when no organization is configured', async () => {
    await renderPage({ config: {} });

    expect(screen.getByText('Coverage of integrated repositories of the GitHub organization')).toBeVisible();
  });

  it('reports the coverage of the whole organization once every stage has landed', async () => {
    await renderPage();

    expect(await screen.findByText('66.7 % not integrated')).toBeVisible();
    expect(screen.getByText(/1 of 3 repositories integrated/)).toBeVisible();
    expect(tabledRepositories()).toEqual(['carbon', 'happn-payments', 'salt']);
  });

  it('lists the uncovered repositories as a worklist, and only those', async () => {
    await renderPage();

    expect(await screen.findByText('Next repositories to onboard')).toBeVisible();
    // Once in the table and once in the worklist for the uncovered ones, table only for carbon.
    await waitFor(() => expect(linkCount('salt')).toBe(2));
    expect(linkCount('happn-payments')).toBe(2);
    expect(linkCount('carbon')).toBe(1);
  });

  describe('the perimeter', () => {
    it('opens on the active repositories, which are the ones that can be onboarded', async () => {
      await renderPage({ githubRepositories: WITH_ARCHIVED });

      // 1 of 3: the archived repository can never be onboarded, so it is not in the figure.
      expect(await screen.findByText('66.7 % not integrated')).toBeVisible();
      expect(screen.getByText(/active repositories/)).toBeVisible();
      await waitFor(() => expect(tabledRepositories()).not.toContain('happn-legacy'));
    });

    it('moves the rows and the figure together when another kind is selected', async () => {
      const user = userEvent.setup();
      await renderPage({ githubRepositories: WITH_ARCHIVED });

      expect(await screen.findByText('66.7 % not integrated')).toBeVisible();
      await selectKind(user, /Archived/);

      expect(await screen.findByText('75 % not integrated')).toBeVisible();
      await waitFor(() => expect(tabledRepositories()).toContain('happn-legacy'));
      expect(within(tableRowFor('happn-legacy')).getByTitle('Archived')).toBeInTheDocument();
    });

    it('leaves the figure alone when a reading aid narrows the table', async () => {
      const user = userEvent.setup();
      await renderPage({ githubRepositories: WITH_ARCHIVED });

      expect(await screen.findByText('66.7 % not integrated')).toBeVisible();
      await user.type(screen.getByRole('searchbox', { name: /filter by repository name/i }), 'carbon');

      // Filtering on one repository must not report the coverage of that one repository.
      await waitFor(() => expect(tabledRepositories()).toEqual(['carbon']));
      expect(screen.getByText('66.7 % not integrated')).toBeVisible();
    });

    it('keeps a repository the provider will never walk out of the worklist', async () => {
      const user = userEvent.setup();
      await renderPage({ githubRepositories: WITH_ARCHIVED });

      await waitFor(() => expect(linkCount('salt')).toBe(2));
      await selectKind(user, /Archived/);

      // In the table now that it is in the perimeter, but still never a thing to do.
      await waitFor(() => expect(linkCount('happn-legacy')).toBe(1));
    });
  });

  it('scopes the KPI to the configured default languages', async () => {
    await renderPage({ config: { integratedRepositories: { organization: ORG, defaultLanguages: ['kotlin'] } } });

    // happn-payments is the only Kotlin repository, and it is not integrated.
    expect(await screen.findByText('100 % not integrated')).toBeVisible();
    expect(screen.getByText(/languages Kotlin/)).toBeVisible();
    await waitFor(() => expect(tabledRepositories()).toEqual(['happn-payments']));
  });

  it('ignores a configured language the organization does not use, rather than blanking the page', async () => {
    await renderPage({ config: { integratedRepositories: { organization: ORG, defaultLanguages: ['Haskell'] } } });

    expect(await screen.findByText('66.7 % not integrated')).toBeVisible();
    // A rendered language cell proves enrichment landed, so the scope below is the settled one.
    expect(await screen.findByText('Python')).toBeVisible();
    expect(screen.getByText(/languages all languages/)).toBeVisible();
  });

  describe('when GitHub is unreachable', () => {
    const githubError = new Error("GitHub GraphQL request for organization 'happn-app' failed with 401");

    it('warns, keeps the catalog-only view, and hides the worklist', async () => {
      await renderPage({ githubError });

      // `WarningPanel` prefixes its own title, hence the partial match.
      expect(await screen.findByText(/GitHub metadata unavailable/)).toBeVisible();
      // The reason sits in the panel's collapsed details, so it is present rather than visible.
      expect(screen.getByText(githubError.message)).toBeInTheDocument();
      expect(screen.queryByText('Next repositories to onboard')).not.toBeInTheDocument();
      await waitFor(() => expect(tabledRepositories()).toEqual(['carbon', 'happn-payments', 'salt']));
    });

    it('still reports the coverage figure, with the uningested repositories as unknown', async () => {
      await renderPage({ githubError });

      expect(await screen.findByText('66.7 % not integrated')).toBeVisible();
      await waitFor(() => expect(within(tableRowFor('salt')).getByText('Unknown')).toBeVisible());
      expect(within(tableRowFor('carbon')).getByText('Integrated')).toBeVisible();
    });
  });

  it('replaces the page with an error panel when the inventory cannot be read', async () => {
    await renderPage({ inventoryError: new Error('catalog unreachable') });

    // `ResponseErrorPanel` repeats the message in its summary and its details.
    expect(await screen.findAllByText(/catalog unreachable/)).not.toHaveLength(0);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('Catalog coverage')).not.toBeInTheDocument();
  });
});
