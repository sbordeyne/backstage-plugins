import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JsonObject } from '@backstage/types';
import { configApiRef } from '@backstage/core-plugin-api';
import { mockApis, TestApiProvider, wrapInTestApp } from '@backstage/test-utils';
import { RepositoriesTable, RepositoriesTableProps } from './RepositoriesTable';
import { selectedTemplateRouteRef } from '../../routes';
import { scrollToSentinel } from '../../setupTests';
import { ALL_REPOSITORY_KINDS } from '../../lib/labels';
import { Perimeter, RepositoryRow } from '../../types';

function row(overrides: Partial<RepositoryRow> & Pick<RepositoryRow, 'repo'>): RepositoryRow {
  return {
    org: 'happn-app',
    url: `https://github.com/happn-app/${overrides.repo}`,
    status: 'not-integrated',
    catalogInfoPaths: [],
    entityCount: 0,
    entityKinds: [],
    isTracked: true,
    providerSkips: [],
    ...overrides,
  };
}

const ROWS: RepositoryRow[] = [
  row({
    repo: 'carbon',
    status: 'integrated',
    catalogInfoPaths: ['catalog-info.yaml'],
    entityCount: 3,
    entityKinds: ['API', 'Component'],
    primaryLanguage: 'Java',
    pushedAt: '2026-07-30T00:00:00Z',
    isPrivate: true,
  }),
  row({
    repo: 'esctl',
    status: 'drift',
    primaryLanguage: 'Kotlin',
    pushedAt: '2026-06-01T00:00:00Z',
    isPrivate: false,
  }),
  row({
    repo: 'salt',
    status: 'not-integrated',
    primaryLanguage: 'Python',
    pushedAt: '2026-05-01T00:00:00Z',
  }),
];

function perimeter(overrides: Partial<Perimeter> = {}): Perimeter {
  return { languages: [], kinds: ALL_REPOSITORY_KINDS, ...overrides };
}

const JAVA_KOTLIN = perimeter({ languages: ['Java', 'Kotlin'] });

const WIZARD_PATH = '/create/templates/:namespace/:templateName';

const CONFIG_WITH_TEMPLATE: JsonObject = {
  integratedRepositories: {
    organization: 'happn-app',
    onboardingTemplateRef: 'template:default/onboard-repository',
  },
};

/**
 * The table reads the configured template and resolves the wizard route, so it needs both an app
 * context and a config API. `TestApiProvider` composes with the test app's own APIs, overriding
 * only the config.
 */
function renderTable(overrides: Partial<RepositoriesTableProps> = {}, config: JsonObject = CONFIG_WITH_TEMPLATE) {
  const props: RepositoriesTableProps = {
    rows: ROWS,
    perimeter: perimeter(),
    inventoryPending: false,
    ingestionPending: false,
    enrichmentPending: false,
    ...overrides,
  };
  return render(
    wrapInTestApp(
      <TestApiProvider apis={[[configApiRef, mockApis.config({ data: config })]]}>
        <RepositoriesTable {...props} />
      </TestApiProvider>,
      { mountedRoutes: { [WIZARD_PATH]: selectedTemplateRouteRef } },
    ),
  );
}

/** The repository name is rendered as the first link of each row. */
function renderedRepositories(): string[] {
  return screen
    .getAllByRole('row')
    .slice(1) // drop the header row
    .map(tableRow => within(tableRow).getAllByRole('link')[0]?.textContent ?? '');
}

function rowFor(repo: string): HTMLElement {
  const found = screen
    .getAllByRole('row')
    .slice(1)
    .find(tableRow => within(tableRow).getAllByRole('link')[0]?.textContent === repo);

  if (!found) {
    throw new Error(`No table row rendered for repository '${repo}'`);
  }
  return found;
}

describe('RepositoriesTable', () => {
  it('lists every repository when no language is selected', () => {
    renderTable();

    expect(renderedRepositories()).toEqual(['carbon', 'esctl', 'salt']);
  });

  it('shows the resolved catalog-info.yaml path and the entity kinds', () => {
    renderTable();

    const carbon = within(rowFor('carbon'));
    expect(carbon.getByText('catalog-info.yaml')).toBeInTheDocument();
    expect(carbon.getByText('API, Component')).toBeInTheDocument();
  });

  it('links each repository to GitHub', () => {
    renderTable();

    expect(screen.getByRole('link', { name: /carbon/ })).toHaveAttribute('href', 'https://github.com/happn-app/carbon');
  });

  describe('the kind column', () => {
    const SKIPPED: RepositoryRow[] = [
      row({ repo: 'archived', isTracked: false, providerSkips: ['archived'] }),
      row({ repo: 'both', isTracked: false, providerSkips: ['archived', 'fork'] }),
      row({ repo: 'empty', isTracked: false, providerSkips: ['no-default-branch'] }),
      row({ repo: 'fresh', isTracked: false }),
      row({ repo: 'walked' }),
    ];

    it('marks each kind with an icon carrying its name', () => {
      // The column is icons only, so the accessible name is what says which kind it is.
      renderTable({ rows: SKIPPED, perimeter: perimeter() });

      expect(within(rowFor('archived')).getByTitle('Archived')).toBeInTheDocument();
      expect(within(rowFor('both')).getByTitle('Archived, Fork')).toBeInTheDocument();
      expect(within(rowFor('empty')).getByTitle('Empty')).toBeInTheDocument();
    });

    it('leaves an active repository unmarked, since that is almost every row', () => {
      renderTable({ rows: SKIPPED, perimeter: perimeter() });

      const active = within(rowFor('walked')).getByTitle('Active');
      expect(active).toBeInTheDocument();
      expect(active).toBeEmptyDOMElement();
    });

    it('distinguishes a repository created since the last sync from an excluded one', () => {
      renderTable({ rows: SKIPPED, perimeter: perimeter() });

      expect(within(rowFor('fresh')).getByTitle('Awaiting sync')).toBeInTheDocument();
      expect(within(rowFor('fresh')).queryByTitle('Archived')).not.toBeInTheDocument();
    });

    it('offers no onboarding action for a repository the provider will never walk', () => {
      renderTable({ rows: SKIPPED, perimeter: perimeter() });

      expect(within(rowFor('archived')).queryByRole('link', { name: 'Integrate' })).not.toBeInTheDocument();
      expect(within(rowFor('fresh')).getByRole('link', { name: 'Integrate' })).toBeInTheDocument();
    });
  });

  describe('perimeter scope', () => {
    it('hides repositories a skip control has excluded', () => {
      const rows = [row({ repo: 'archived', providerSkips: ['archived'] }), row({ repo: 'walked' })];

      renderTable({ rows, perimeter: perimeter({ kinds: ['active', 'fork', 'no-default-branch'] }) });

      expect(renderedRepositories()).toEqual(['walked']);
    });

    it('hides repositories outside the selected languages', () => {
      renderTable({ perimeter: JAVA_KOTLIN });

      expect(renderedRepositories()).toEqual(['carbon', 'esctl']);
    });

    it('reveals the excluded repositories, marked, through the toggle', async () => {
      const user = userEvent.setup();
      renderTable({ perimeter: JAVA_KOTLIN });

      await user.click(screen.getByRole('switch', { name: /show repositories outside the perimeter/i }));

      expect(renderedRepositories()).toEqual(['carbon', 'esctl', 'salt']);
      expect(screen.getByText('Outside the perimeter')).toBeInTheDocument();
    });

    it('does not offer the toggle when nothing is filtered out', () => {
      renderTable({ perimeter: perimeter() });

      expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    });
  });

  describe('filtering and sorting', () => {
    it('narrows to integrated repositories through the binary grouping', async () => {
      const user = userEvent.setup();
      renderTable();

      await user.click(screen.getByRole('button', { name: /catalog status/i }));
      await user.click(screen.getByRole('option', { name: 'Integrated — any' }));

      expect(renderedRepositories()).toEqual(['carbon']);
    });

    it('narrows to non-integrated repositories through the binary grouping', async () => {
      const user = userEvent.setup();
      renderTable();

      await user.click(screen.getByRole('button', { name: /catalog status/i }));
      await user.click(screen.getByRole('option', { name: 'Not integrated — any' }));

      expect(renderedRepositories()).toEqual(['esctl', 'salt']);
    });

    it('narrows to a single status through the same control', async () => {
      const user = userEvent.setup();
      renderTable();

      await user.click(screen.getByRole('button', { name: /catalog status/i }));
      await user.click(screen.getByRole('option', { name: 'Drift' }));

      expect(renderedRepositories()).toEqual(['esctl']);
    });

    it('filters by repository name', async () => {
      const user = userEvent.setup();
      renderTable();

      await user.type(screen.getByRole('searchbox', { name: /repository name/i }), 'car');

      expect(await screen.findByText('Showing 1 of 1 repositories')).toBeInTheDocument();
      expect(renderedRepositories()).toEqual(['carbon']);
    });

    it('reverses the order when the repository column is sorted descending', async () => {
      const user = userEvent.setup();
      renderTable();

      await user.click(screen.getByRole('columnheader', { name: /repository/i }));

      expect(renderedRepositories()).toEqual(['salt', 'esctl', 'carbon']);
    });
  });

  describe('scroll pagination', () => {
    const MANY_ROWS = Array.from({ length: 45 }, (_unused, index) =>
      row({ repo: `repo-${String(index).padStart(2, '0')}`, primaryLanguage: 'Java' }),
    );

    it('renders only the first page and reports the total', () => {
      renderTable({ rows: MANY_ROWS });

      expect(renderedRepositories()).toHaveLength(20);
      expect(screen.getByText('Showing 20 of 45 repositories')).toBeInTheDocument();
    });

    it('reveals another page when the sentinel scrolls into view', () => {
      renderTable({ rows: MANY_ROWS });

      act(() => scrollToSentinel());

      expect(renderedRepositories()).toHaveLength(40);
      expect(screen.getByText('Showing 40 of 45 repositories')).toBeInTheDocument();
    });

    it('stops at the total and drops the affordance once everything is shown', async () => {
      const user = userEvent.setup();
      renderTable({ rows: MANY_ROWS });

      await user.click(screen.getByRole('button', { name: /show more repositories/i }));
      await user.click(screen.getByRole('button', { name: /show more repositories/i }));

      expect(renderedRepositories()).toHaveLength(45);
      expect(screen.queryByRole('button', { name: /show more repositories/i })).not.toBeInTheDocument();
    });

    it('returns to the first page when the filter changes', async () => {
      const user = userEvent.setup();
      renderTable({ rows: MANY_ROWS });

      act(() => scrollToSentinel());
      expect(renderedRepositories()).toHaveLength(40);

      await user.click(screen.getByRole('button', { name: /catalog status/i }));
      await user.click(screen.getByRole('option', { name: 'Not integrated — any' }));

      expect(renderedRepositories()).toHaveLength(20);
    });
  });

  describe('staged loading', () => {
    it('renders skeleton rows while the inventory is loading', () => {
      renderTable({ inventoryPending: true, ingestionPending: true, enrichmentPending: true });

      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
    });

    it('shows repositories with a pending status while ingestion is still loading', () => {
      renderTable({ ingestionPending: true });

      expect(renderedRepositories()).toEqual(['carbon', 'esctl', 'salt']);
      // Scoped to the row, because "Integrated" is also a filter option label.
      expect(within(rowFor('carbon')).queryByText('Integrated')).not.toBeInTheDocument();
      expect(within(rowFor('carbon')).queryByText('catalog-info.yaml')).not.toBeInTheDocument();
    });

    it('hides language and push date while enrichment is still loading', () => {
      renderTable({ enrichmentPending: true });

      expect(renderedRepositories()).toEqual(['carbon', 'esctl', 'salt']);
      expect(screen.queryByText('Java')).not.toBeInTheDocument();
      expect(screen.queryByText('2026-07-30')).not.toBeInTheDocument();
    });
  });

  describe('onboarding action', () => {
    function integrateLinkIn(repo: string): HTMLElement | null {
      return within(rowFor(repo)).queryByRole('link', { name: 'Integrate' });
    }

    it('offers the action only for repositories that are not in the catalog', () => {
      renderTable();

      expect(integrateLinkIn('salt')).toBeInTheDocument();
      expect(integrateLinkIn('carbon')).not.toBeInTheDocument();
      // Drift means a catalog-info.yaml already exists, so a pull request adding one would conflict.
      expect(integrateLinkIn('esctl')).not.toBeInTheDocument();
    });

    it('links to the scaffolder wizard with the repository prefilled', () => {
      renderTable();

      const href = integrateLinkIn('salt')?.getAttribute('href') ?? '';
      const url = new URL(href, 'http://localhost');

      expect(url.pathname).toBe('/create/templates/default/onboard-repository');
      expect(JSON.parse(url.searchParams.get('formData') ?? '{}')).toEqual({
        repoUrl: 'github.com?owner=happn-app&repo=salt',
        name: 'salt',
        defaultBranch: 'master',
      });
    });

    it('waits for ingestion, since a repository looks uncovered until its entities are joined', () => {
      renderTable({ ingestionPending: true });

      expect(screen.queryByRole('link', { name: 'Integrate' })).not.toBeInTheDocument();
    });

    it('falls back to the plain catalog-info cell when no template is configured', () => {
      renderTable({}, { integratedRepositories: { organization: 'happn-app' } });

      expect(screen.queryByRole('link', { name: 'Integrate' })).not.toBeInTheDocument();
      // The repository name is a row header, so the catalog-info.yaml cell is the second plain cell.
      const catalogInfoCell = within(rowFor('salt')).getAllByRole('gridcell')[1];
      expect(within(catalogInfoCell).getByText('—')).toBeInTheDocument();
    });

    it('leaves the repository name as the first link of its row', () => {
      renderTable();

      expect(renderedRepositories()).toEqual(['carbon', 'esctl', 'salt']);
    });
  });
});
