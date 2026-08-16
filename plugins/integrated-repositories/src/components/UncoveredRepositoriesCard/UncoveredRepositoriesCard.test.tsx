import { render, screen, within } from '@testing-library/react';
import { UncoveredRepositoriesCard } from './UncoveredRepositoriesCard';
import { ALL_REPOSITORY_KINDS } from '../../lib/labels';
import { Perimeter, RepositoryRow } from '../../types';

function perimeter(languages: string[] = []): Perimeter {
  return { languages, kinds: ALL_REPOSITORY_KINDS };
}

const ORG = 'happn-app';

function row(repo: string, overrides: Partial<RepositoryRow> = {}): RepositoryRow {
  return {
    repo,
    org: ORG,
    url: `https://github.com/${ORG}/${repo}`,
    status: 'not-integrated',
    catalogInfoPaths: [],
    entityCount: 0,
    entityKinds: [],
    primaryLanguage: 'Java',
    pushedAt: '2026-07-01T00:00:00Z',
    isPrivate: true,
    isTracked: true,
    providerSkips: [],
    ...overrides,
  };
}

function renderCard(rows: RepositoryRow[], languages: string[] = [], pending: boolean = false) {
  return render(<UncoveredRepositoriesCard rows={rows} perimeter={perimeter(languages)} pending={pending} />);
}

/** The suggestions in render order. */
function suggestedRepositories(): string[] {
  return screen.getAllByRole('link').map(link => link.textContent ?? '');
}

describe('UncoveredRepositoriesCard', () => {
  it('lists the uncovered repositories, most recently pushed first', () => {
    renderCard([
      row('salt', { pushedAt: '2026-03-02T00:00:00Z' }),
      row('officectl', { pushedAt: '2025-11-02T00:00:00Z' }),
      row('happn-payments', { pushedAt: '2026-07-20T00:00:00Z' }),
    ]);

    expect(suggestedRepositories()).toEqual(['happn-payments', 'salt', 'officectl']);
  });

  it('puts drift first, since the file is already committed', () => {
    renderCard([
      row('happn-payments', { pushedAt: '2026-07-30T00:00:00Z' }),
      row('esctl', { status: 'drift', pushedAt: '2026-01-01T00:00:00Z' }),
    ]);

    expect(suggestedRepositories()).toEqual(['esctl', 'happn-payments']);
  });

  it('leaves out the repositories that are already integrated', () => {
    renderCard([row('carbon', { status: 'integrated' }), row('docker', { status: 'integrated-nested' }), row('salt')]);

    expect(suggestedRepositories()).toEqual(['salt']);
  });

  it('honours the language selection', () => {
    renderCard(
      [row('salt', { primaryLanguage: 'Python' }), row('happn-payments', { primaryLanguage: 'Kotlin' })],
      ['Kotlin'],
    );

    expect(suggestedRepositories()).toEqual(['happn-payments']);
  });

  it('leaves out repositories the provider will never walk, which cannot be onboarded', () => {
    renderCard([
      row('archived', { providerSkips: ['archived'], pushedAt: '2026-07-30T00:00:00Z' }),
      row('a-fork', { providerSkips: ['fork'], pushedAt: '2026-07-29T00:00:00Z' }),
      row('salt', { pushedAt: '2026-01-01T00:00:00Z' }),
    ]);

    expect(suggestedRepositories()).toEqual(['salt']);
  });

  it('caps the worklist at ten repositories', () => {
    const rows = Array.from({ length: 14 }, (_unused, index) =>
      row(`repo-${index}`, { pushedAt: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00Z` }),
    );

    renderCard(rows);

    expect(screen.getAllByRole('link')).toHaveLength(10);
  });

  it('shows the status and the last push date of each suggestion', () => {
    renderCard([row('esctl', { status: 'drift', pushedAt: '2026-07-28T09:00:00Z' })]);

    const suggestion = screen.getByRole('link', { name: 'esctl' }).parentElement as HTMLElement;
    expect(within(suggestion).getByText('Drift')).toBeInTheDocument();
    expect(within(suggestion).getByText('2026-07-28')).toBeInTheDocument();
  });

  it('stays on screen with no suggestions while enrichment is pending, since ranking needs the push dates', () => {
    // Ranking by `pushedAt` before GitHub answers would order the worklist arbitrarily and then
    // reshuffle it, so the card holds its place instead.
    renderCard([row('salt'), row('officectl')], [], true);

    expect(screen.getByText('Next repositories to onboard')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('disappears entirely once nothing is left to onboard', () => {
    const { container } = renderCard([row('carbon', { status: 'integrated' })]);

    expect(container).toBeEmptyDOMElement();
  });
});
