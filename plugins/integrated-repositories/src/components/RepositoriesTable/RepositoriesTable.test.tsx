import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RepositoriesTable, RepositoriesTableProps } from './RepositoriesTable';
import { scrollToSentinel } from '../../setupTests';
import { RepositoryRow } from '../../types';

function row(overrides: Partial<RepositoryRow> & Pick<RepositoryRow, 'repo'>): RepositoryRow {
  return {
    org: 'example-org',
    url: `https://github.com/example-org/${overrides.repo}`,
    status: 'not-integrated',
    catalogInfoPaths: [],
    entityCount: 0,
    entityKinds: [],
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

const JAVA_KOTLIN = ['Java', 'Kotlin'];

function renderTable(overrides: Partial<RepositoriesTableProps> = {}) {
  const props: RepositoriesTableProps = {
    rows: ROWS,
    selectedLanguages: [],
    inventoryPending: false,
    ingestionPending: false,
    enrichmentPending: false,
    ...overrides,
  };
  return render(<RepositoriesTable {...props} />);
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

    expect(screen.getByRole('link', { name: /carbon/ })).toHaveAttribute(
      'href',
      'https://github.com/example-org/carbon',
    );
  });

  describe('language scope', () => {
    it('hides repositories outside the selected languages', () => {
      renderTable({ selectedLanguages: JAVA_KOTLIN });

      expect(renderedRepositories()).toEqual(['carbon', 'esctl']);
    });

    it('reveals the excluded repositories, marked, through the toggle', async () => {
      const user = userEvent.setup();
      renderTable({ selectedLanguages: JAVA_KOTLIN });

      await user.click(screen.getByRole('switch', { name: /show other languages/i }));

      expect(renderedRepositories()).toEqual(['carbon', 'esctl', 'salt']);
      expect(screen.getByText('Outside the selected languages')).toBeInTheDocument();
    });

    it('does not offer the toggle when nothing is filtered out', () => {
      renderTable({ selectedLanguages: [] });

      expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    });
  });

  describe('filtering and sorting', () => {
    it('narrows to integrated repositories through the binary filter', async () => {
      const user = userEvent.setup();
      renderTable();

      await user.click(screen.getByRole('button', { name: /catalog integration/i }));
      await user.click(screen.getByRole('option', { name: 'Integrated' }));

      expect(renderedRepositories()).toEqual(['carbon']);
    });

    it('narrows to non-integrated repositories through the binary filter', async () => {
      const user = userEvent.setup();
      renderTable();

      await user.click(screen.getByRole('button', { name: /catalog integration/i }));
      await user.click(screen.getByRole('option', { name: 'Not integrated' }));

      expect(renderedRepositories()).toEqual(['esctl', 'salt']);
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

      await user.click(screen.getByRole('button', { name: /catalog integration/i }));
      await user.click(screen.getByRole('option', { name: 'Not integrated' }));

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
});
