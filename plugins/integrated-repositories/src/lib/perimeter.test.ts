import { ALL_REPOSITORY_KINDS } from './labels';
import {
  collectKindOptions,
  collectLanguageOptions,
  DEFAULT_PERIMETER,
  describePerimeter,
  isInPerimeter,
  isKindSelected,
  isLanguageSelected,
  repositoryKinds,
} from './perimeter';
import { Perimeter, RepositoryKind, RepositoryRow, UNKNOWN_LANGUAGE } from '../types';

function row(repo: string, overrides: Partial<RepositoryRow> = {}): RepositoryRow {
  return {
    repo,
    org: 'happn-app',
    url: `https://github.com/happn-app/${repo}`,
    status: 'not-integrated',
    catalogInfoPaths: [],
    entityCount: 0,
    entityKinds: [],
    primaryLanguage: 'Java',
    isTracked: true,
    providerSkips: [],
    ...overrides,
  };
}

/** Every kind, unless a test narrows it — the default perimeter is only the active ones. */
function perimeter(overrides: Partial<Perimeter> = {}): Perimeter {
  return { languages: [], kinds: ALL_REPOSITORY_KINDS, ...overrides };
}

function withKinds(...kinds: RepositoryKind[]): Perimeter {
  return perimeter({ kinds });
}

describe('DEFAULT_PERIMETER', () => {
  it('opens on the active repositories in every language', () => {
    expect(DEFAULT_PERIMETER).toEqual({ languages: [], kinds: ['active'] });
  });
});

describe('repositoryKinds', () => {
  it('calls a repository with no skip reason active', () => {
    expect(repositoryKinds(row('carbon'))).toEqual(['active']);
  });

  it('reports every reason at once', () => {
    expect(repositoryKinds(row('both', { providerSkips: ['archived', 'fork'] }))).toEqual(['archived', 'fork']);
  });
});

describe('isLanguageSelected', () => {
  const java = row('java-repo');
  const noLanguage = row('no-language', { primaryLanguage: undefined });

  it('matches everything when the selection is empty, so clearing never blanks the page', () => {
    expect(isLanguageSelected(java, [])).toBe(true);
    expect(isLanguageSelected(noLanguage, [])).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(isLanguageSelected(java, ['java'])).toBe(true);
    expect(isLanguageSelected(row('k', { primaryLanguage: 'kotlin' }), ['Kotlin'])).toBe(true);
  });

  it('excludes languages that are not selected', () => {
    expect(isLanguageSelected(java, ['Kotlin', 'Go'])).toBe(false);
  });

  it('matches a repository without a language only through the Unknown option', () => {
    expect(isLanguageSelected(noLanguage, ['Java'])).toBe(false);
    expect(isLanguageSelected(noLanguage, [UNKNOWN_LANGUAGE])).toBe(true);
  });
});

describe('isKindSelected', () => {
  const archived = row('archived', { providerSkips: ['archived'] });
  const archivedFork = row('both', { providerSkips: ['archived', 'fork'] });

  it('matches every kind when the selection is empty', () => {
    expect(isKindSelected(archived, [])).toBe(true);
    expect(isKindSelected(row('carbon'), [])).toBe(true);
  });

  it('selects only the chosen kind', () => {
    expect(isKindSelected(archived, ['archived'])).toBe(true);
    expect(isKindSelected(archived, ['active'])).toBe(false);
    expect(isKindSelected(row('carbon'), ['active'])).toBe(true);
  });

  it('takes a combination of kinds', () => {
    expect(isKindSelected(archived, ['active', 'archived'])).toBe(true);
    expect(isKindSelected(row('a-fork', { providerSkips: ['fork'] }), ['active', 'archived'])).toBe(false);
  });

  it('matches a repository that is several kinds under any one of them', () => {
    expect(isKindSelected(archivedFork, ['archived'])).toBe(true);
    expect(isKindSelected(archivedFork, ['fork'])).toBe(true);
    expect(isKindSelected(archivedFork, ['active'])).toBe(false);
  });
});

describe('isInPerimeter', () => {
  it('applies the language selection and the kinds together', () => {
    const goArchived = row('go-archived', { primaryLanguage: 'Go', providerSkips: ['archived'] });

    expect(isInPerimeter(goArchived, perimeter({ languages: ['Go'] }))).toBe(true);
    expect(isInPerimeter(goArchived, perimeter({ languages: ['Java'] }))).toBe(false);
    expect(isInPerimeter(goArchived, withKinds('active'))).toBe(false);
  });
});

describe('collectKindOptions', () => {
  const rows = [
    row('a', { providerSkips: ['archived'] }),
    row('b', { providerSkips: ['archived'] }),
    row('c', { providerSkips: ['fork'] }),
    row('d'),
  ];

  it('offers an option only for a kind that actually occurs', () => {
    expect(collectKindOptions(rows, perimeter()).map(option => option.id)).toEqual(['active', 'archived', 'fork']);
  });

  it('carries how many repositories each kind holds', () => {
    expect(collectKindOptions(rows, perimeter())).toEqual([
      { id: 'active', label: 'Active', repositoryCount: 1 },
      { id: 'archived', label: 'Archived', repositoryCount: 2 },
      { id: 'fork', label: 'Fork', repositoryCount: 1 },
    ]);
  });

  it('counts a repository of several kinds under each of them', () => {
    const overlapping = [row('both', { providerSkips: ['archived', 'fork'] })];

    expect(collectKindOptions(overlapping, perimeter()).map(option => option.repositoryCount)).toEqual([1, 1]);
  });

  it('counts within the language selection, so the number matches what selecting it leaves', () => {
    const mixed = [
      row('java-archived', { providerSkips: ['archived'] }),
      row('go-archived', { primaryLanguage: 'Go', providerSkips: ['archived'] }),
    ];

    expect(collectKindOptions(mixed, perimeter({ languages: ['Java'] }))[0].repositoryCount).toBe(1);
  });

  it('keeps counting a kind that is not currently selected, so it can be selected', () => {
    expect(collectKindOptions(rows, withKinds('active'))).toEqual([
      { id: 'active', label: 'Active', repositoryCount: 1 },
      { id: 'archived', label: 'Archived', repositoryCount: 2 },
      { id: 'fork', label: 'Fork', repositoryCount: 1 },
    ]);
  });
});

describe('collectLanguageOptions', () => {
  it('orders by repository count, then name, and appends Unknown last', () => {
    const rows = [
      row('a'),
      row('b'),
      row('c', { primaryLanguage: 'Kotlin' }),
      row('d', { primaryLanguage: 'Go' }),
      row('e', { primaryLanguage: undefined }),
    ];

    expect(collectLanguageOptions(rows, perimeter())).toEqual([
      { id: 'Java', label: 'Java', repositoryCount: 2 },
      { id: 'Go', label: 'Go', repositoryCount: 1 },
      { id: 'Kotlin', label: 'Kotlin', repositoryCount: 1 },
      { id: UNKNOWN_LANGUAGE, label: 'Unknown', repositoryCount: 1 },
    ]);
  });

  it('omits the Unknown option when every repository has a language', () => {
    expect(collectLanguageOptions([row('a')], perimeter())).toEqual([
      { id: 'Java', label: 'Java', repositoryCount: 1 },
    ]);
  });

  it('counts only the kinds currently selected', () => {
    const rows = [row('a'), row('archived', { providerSkips: ['archived'] })];

    expect(collectLanguageOptions(rows, perimeter())[0].repositoryCount).toBe(2);
    expect(collectLanguageOptions(rows, withKinds('active'))[0].repositoryCount).toBe(1);
  });
});

describe('describePerimeter', () => {
  it('names the kinds the figure was measured over', () => {
    expect(describePerimeter(DEFAULT_PERIMETER)).toBe('languages all languages, active repositories');
  });

  it('names every kind when they are all selected', () => {
    expect(describePerimeter(perimeter())).toBe('languages all languages, active, archived, fork, empty repositories');
  });

  it('reads an empty selection as every kind', () => {
    expect(describePerimeter(withKinds())).toBe('languages all languages, repositories of every kind');
  });

  it('names the languages alongside the kinds', () => {
    expect(describePerimeter(perimeter({ languages: ['Java', 'Kotlin'], kinds: ['archived'] }))).toBe(
      'languages Java, Kotlin, archived repositories',
    );
  });
});
