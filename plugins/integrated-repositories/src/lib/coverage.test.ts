import { Entity } from '@backstage/catalog-model';
import {
  buildRepositoryRows,
  countRepositoriesWithoutLocation,
  isCovered,
  collectLanguageOptions,
  isLanguageSelected,
  selectUncoveredRepositories,
  summarizeCoverage,
} from './coverage';
import { GithubRepositoryInfo, RepositoryLocation, RepositoryRow, UNKNOWN_LANGUAGE } from '../types';

const ORG = 'example-org';

function location(repo: string): RepositoryLocation {
  return {
    host: 'github.com',
    org: ORG,
    repo,
    target: `https://github.com/${ORG}/${repo}/blob/master/**/catalog-info.yaml`,
  };
}

let childCounter = 0;

function child(repo: string, path: string, kind: string = 'Component'): Entity {
  childCounter += 1;
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind,
    metadata: {
      name: `entity-${childCounter}`,
      annotations: {
        'backstage.io/managed-by-origin-location': `url:https://github.com/${ORG}/${repo}/blob/master/**/catalog-info.yaml`,
        'backstage.io/managed-by-location': `url:https://github.com/${ORG}/${repo}/tree/master/${path}`,
      },
    },
  } as Entity;
}

function githubRepo(name: string, overrides: Partial<GithubRepositoryInfo> = {}): GithubRepositoryInfo {
  return {
    name,
    url: `https://github.com/${ORG}/${name}`,
    isPrivate: true,
    pushedAt: '2026-07-01T00:00:00Z',
    primaryLanguage: 'Java',
    hasRootCatalogInfo: false,
    ...overrides,
  };
}

function githubIndex(repositories: GithubRepositoryInfo[]): Map<string, GithubRepositoryInfo> {
  return new Map(repositories.map(repository => [repository.name, repository]));
}

function rowsFor(
  locations: RepositoryLocation[],
  children: Entity[],
  repositories: GithubRepositoryInfo[],
  githubEnrichmentAvailable: boolean = true,
): RepositoryRow[] {
  return buildRepositoryRows({
    locations,
    children,
    githubRepositories: githubIndex(repositories),
    githubEnrichmentAvailable,
  });
}

describe('buildRepositoryRows', () => {
  it('marks a repository with a root catalog-info.yaml as integrated', () => {
    const [row] = rowsFor([location('carbon')], [child('carbon', 'catalog-info.yaml')], [githubRepo('carbon')]);

    expect(row).toMatchObject({
      repo: 'carbon',
      status: 'integrated',
      catalogInfoPaths: ['catalog-info.yaml'],
      entityCount: 1,
      entityKinds: ['Component'],
    });
  });

  it('marks a monorepo with only nested files as integrated-nested', () => {
    const [row] = rowsFor(
      [location('docker')],
      [child('docker', 'images/debug/catalog-info.yaml'), child('docker', 'images/backend/init/catalog-info.yaml')],
      [githubRepo('docker')],
    );

    expect(row).toMatchObject({
      status: 'integrated-nested',
      entityCount: 2,
      catalogInfoPaths: ['images/backend/init/catalog-info.yaml', 'images/debug/catalog-info.yaml'],
    });
  });

  it('marks a monorepo that also has a root file as integrated', () => {
    const [row] = rowsFor(
      [location('backend')],
      [child('backend', 'catalog-info.yaml'), child('backend', 'services/front-api/catalog-info.yaml')],
      [githubRepo('backend')],
    );

    expect(row.status).toBe('integrated');
  });

  it('marks an uningested repository whose root file exists as drift', () => {
    const [row] = rowsFor([location('esctl')], [], [githubRepo('esctl', { hasRootCatalogInfo: true })]);

    expect(row).toMatchObject({ status: 'drift', entityCount: 0, catalogInfoPaths: [] });
  });

  it('marks an uningested repository with no root file as not-integrated', () => {
    const [row] = rowsFor([location('salt')], [], [githubRepo('salt', { hasRootCatalogInfo: false })]);

    expect(row.status).toBe('not-integrated');
  });

  it('reports unknown when GitHub enrichment is unavailable', () => {
    const [row] = rowsFor([location('salt')], [], [], false);

    expect(row).toMatchObject({ status: 'unknown', primaryLanguage: undefined });
  });

  it('reports unknown when the repository is absent from the GitHub response', () => {
    const [row] = rowsFor([location('renamed')], [], [githubRepo('other')]);

    expect(row.status).toBe('unknown');
  });

  it('still counts entities whose resolved path cannot be parsed', () => {
    const orphan = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Component',
      metadata: {
        name: 'weird',
        annotations: {
          'backstage.io/managed-by-origin-location': `url:https://github.com/${ORG}/weird/blob/master/**/catalog-info.yaml`,
        },
      },
    } as Entity;

    const [row] = rowsFor([location('weird')], [orphan], [githubRepo('weird')]);

    expect(row).toMatchObject({ status: 'integrated', entityCount: 1, catalogInfoPaths: [] });
  });

  it('does not treat the provider Location itself as an ingested entity', () => {
    // The generated Location carries its own target as its origin annotation, so counting it
    // would make every repository in the organization look integrated.
    const providerLocation = {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Location',
      metadata: {
        name: 'generated-abc123',
        annotations: {
          'backstage.io/managed-by-origin-location': `url:https://github.com/${ORG}/salt/blob/master/**/catalog-info.yaml`,
          'backstage.io/managed-by-location': `url:https://github.com/${ORG}/salt/blob/master/**/catalog-info.yaml`,
        },
      },
    } as Entity;

    const [row] = rowsFor([location('salt')], [providerLocation], [githubRepo('salt')]);

    expect(row).toMatchObject({ status: 'not-integrated', entityCount: 0 });
  });

  it('collects distinct entity kinds', () => {
    const [row] = rowsFor(
      [location('carbon')],
      [child('carbon', 'catalog-info.yaml', 'Component'), child('carbon', 'catalog-info.yaml', 'API')],
      [githubRepo('carbon')],
    );

    expect(row.entityKinds).toEqual(['API', 'Component']);
  });

  it('carries the primary language through from GitHub', () => {
    const rows = rowsFor(
      [location('a-java'), location('b-kotlin'), location('c-go'), location('d-none')],
      [],
      [
        githubRepo('a-java', { primaryLanguage: 'java' }),
        githubRepo('b-kotlin', { primaryLanguage: 'Kotlin' }),
        githubRepo('c-go', { primaryLanguage: 'Go' }),
        githubRepo('d-none', { primaryLanguage: undefined }),
      ],
    );

    expect(rows.map(row => row.primaryLanguage)).toEqual(['java', 'Kotlin', 'Go', undefined]);
  });

  it('sorts rows by repository name and falls back to a derived url', () => {
    const rows = rowsFor([location('zulu'), location('alpha')], [], []);

    expect(rows.map(row => row.repo)).toEqual(['alpha', 'zulu']);
    expect(rows[0].url).toBe(`https://github.com/${ORG}/alpha`);
  });

  it('does not attribute entities from one repository to another', () => {
    const rows = rowsFor(
      [location('carbon'), location('carbon-utils')],
      [child('carbon', 'catalog-info.yaml')],
      [githubRepo('carbon'), githubRepo('carbon-utils')],
    );

    expect(rows.map(row => [row.repo, row.entityCount])).toEqual([
      ['carbon', 1],
      ['carbon-utils', 0],
    ]);
  });
});

describe('summarizeCoverage', () => {
  it('reports the uncovered percentage as the headline figure', () => {
    const rows = rowsFor(
      [location('a'), location('b'), location('c'), location('d')],
      [child('a', 'catalog-info.yaml')],
      [githubRepo('a'), githubRepo('b'), githubRepo('c'), githubRepo('d')],
    );

    expect(summarizeCoverage(rows, [])).toMatchObject({
      total: 4,
      integrated: 1,
      notIntegrated: 3,
      uncoveredPercentage: 75,
      coveredPercentage: 25,
    });
  });

  it('matches the figures measured against the live catalog', () => {
    const locations = Array.from({ length: 148 }, (_unused, index) =>
      location(`repo-${String(index).padStart(3, '0')}`),
    );
    const children = locations.slice(0, 78).map(entry => child(entry.repo, 'catalog-info.yaml'));

    const stats = summarizeCoverage(rowsFor(locations, children, []), []);

    expect(stats).toMatchObject({
      total: 148,
      integrated: 78,
      notIntegrated: 70,
      uncoveredPercentage: 47.3,
      coveredPercentage: 52.7,
    });
  });

  it('counts nested-only repositories as covered', () => {
    const rows = rowsFor(
      [location('docker')],
      [child('docker', 'images/debug/catalog-info.yaml')],
      [githubRepo('docker')],
    );

    expect(summarizeCoverage(rows, [])).toMatchObject({
      integrated: 1,
      nestedOnly: 1,
      uncoveredPercentage: 0,
    });
  });

  it('narrows the denominator to the selected languages', () => {
    const rows = rowsFor(
      [location('java-covered'), location('java-uncovered'), location('go-uncovered')],
      [child('java-covered', 'catalog-info.yaml')],
      [
        githubRepo('java-covered', { primaryLanguage: 'Java' }),
        githubRepo('java-uncovered', { primaryLanguage: 'Java' }),
        githubRepo('go-uncovered', { primaryLanguage: 'Go' }),
      ],
    );

    expect(summarizeCoverage(rows, ['Java', 'Kotlin'])).toMatchObject({
      total: 2,
      integrated: 1,
      uncoveredPercentage: 50,
    });
    expect(summarizeCoverage(rows, [])).toMatchObject({ total: 3, integrated: 1, uncoveredPercentage: 66.7 });
  });

  it('sums the entities of the repositories in scope only', () => {
    const rows = rowsFor(
      [location('java-repo'), location('go-repo')],
      [child('java-repo', 'catalog-info.yaml'), child('go-repo', 'catalog-info.yaml')],
      [githubRepo('java-repo', { primaryLanguage: 'Java' }), githubRepo('go-repo', { primaryLanguage: 'Go' })],
    );

    expect(summarizeCoverage(rows, ['Java', 'Kotlin']).entityCount).toBe(1);
    expect(summarizeCoverage(rows, []).entityCount).toBe(2);
  });

  it('reports zeroes rather than NaN when nothing is in scope', () => {
    expect(summarizeCoverage([], ['Java', 'Kotlin'])).toMatchObject({
      total: 0,
      uncoveredPercentage: 0,
      coveredPercentage: 0,
    });
  });

  it('counts unknown repositories as uncovered when enrichment failed', () => {
    const rows = rowsFor([location('a'), location('b')], [child('a', 'catalog-info.yaml')], [], false);

    expect(summarizeCoverage(rows, [])).toMatchObject({
      total: 2,
      integrated: 1,
      unknown: 1,
      uncoveredPercentage: 50,
    });
  });
});

describe('selectUncoveredRepositories', () => {
  it('puts drift first, then orders by most recent push', () => {
    const rows = rowsFor(
      [location('stale'), location('fresh'), location('drifting')],
      [],
      [
        githubRepo('stale', { pushedAt: '2026-01-01T00:00:00Z' }),
        githubRepo('fresh', { pushedAt: '2026-07-30T00:00:00Z' }),
        githubRepo('drifting', { pushedAt: '2025-01-01T00:00:00Z', hasRootCatalogInfo: true }),
      ],
    );

    expect(selectUncoveredRepositories(rows, [], 10).map(row => row.repo)).toEqual(['drifting', 'fresh', 'stale']);
  });

  it('excludes covered repositories and honours the limit', () => {
    const rows = rowsFor(
      [location('a'), location('b'), location('c')],
      [child('a', 'catalog-info.yaml')],
      [githubRepo('a'), githubRepo('b'), githubRepo('c')],
    );

    expect(selectUncoveredRepositories(rows, [], 1)).toHaveLength(1);
    expect(selectUncoveredRepositories(rows, [], 10).map(row => row.repo)).not.toContain('a');
  });
});

describe('countRepositoriesWithoutLocation', () => {
  it('counts the GitHub repositories the provider does not track', () => {
    const count = countRepositoriesWithoutLocation(
      [location('tracked')],
      githubIndex([githubRepo('tracked'), githubRepo('archived'), githubRepo('a-fork')]),
    );

    expect(count).toBe(2);
  });
});

describe('isCovered', () => {
  it('treats both integrated statuses as covered', () => {
    expect(isCovered('integrated')).toBe(true);
    expect(isCovered('integrated-nested')).toBe(true);
    expect(isCovered('drift')).toBe(false);
    expect(isCovered('not-integrated')).toBe(false);
    expect(isCovered('unknown')).toBe(false);
  });
});

describe('isLanguageSelected', () => {
  const java = { primaryLanguage: 'Java' } as RepositoryRow;
  const noLanguage = {} as RepositoryRow;

  it('matches everything when the selection is empty, so clearing never blanks the page', () => {
    expect(isLanguageSelected(java, [])).toBe(true);
    expect(isLanguageSelected(noLanguage, [])).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(isLanguageSelected(java, ['java'])).toBe(true);
    expect(isLanguageSelected({ primaryLanguage: 'kotlin' } as RepositoryRow, ['Kotlin'])).toBe(true);
  });

  it('excludes languages that are not selected', () => {
    expect(isLanguageSelected(java, ['Kotlin', 'Go'])).toBe(false);
  });

  it('matches a repository without a language only through the Unknown option', () => {
    expect(isLanguageSelected(noLanguage, ['Java'])).toBe(false);
    expect(isLanguageSelected(noLanguage, [UNKNOWN_LANGUAGE])).toBe(true);
  });
});

describe('collectLanguageOptions', () => {
  it('orders by repository count, then name, and appends Unknown last', () => {
    const rows = rowsFor(
      [location('a'), location('b'), location('c'), location('d'), location('e')],
      [],
      [
        githubRepo('a', { primaryLanguage: 'Java' }),
        githubRepo('b', { primaryLanguage: 'Java' }),
        githubRepo('c', { primaryLanguage: 'Kotlin' }),
        githubRepo('d', { primaryLanguage: 'Go' }),
        githubRepo('e', { primaryLanguage: undefined }),
      ],
    );

    expect(collectLanguageOptions(rows)).toEqual([
      { id: 'Java', label: 'Java', repositoryCount: 2 },
      { id: 'Go', label: 'Go', repositoryCount: 1 },
      { id: 'Kotlin', label: 'Kotlin', repositoryCount: 1 },
      { id: UNKNOWN_LANGUAGE, label: 'Unknown', repositoryCount: 1 },
    ]);
  });

  it('omits the Unknown option when every repository has a language', () => {
    const rows = rowsFor([location('a')], [], [githubRepo('a', { primaryLanguage: 'Java' })]);

    expect(collectLanguageOptions(rows)).toEqual([{ id: 'Java', label: 'Java', repositoryCount: 1 }]);
  });

  it('returns only Unknown before GitHub enrichment lands', () => {
    const rows = rowsFor([location('a'), location('b')], [], [], false);

    expect(collectLanguageOptions(rows)).toEqual([{ id: UNKNOWN_LANGUAGE, label: 'Unknown', repositoryCount: 2 }]);
  });
});
