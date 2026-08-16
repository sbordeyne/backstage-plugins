import { Entity } from '@backstage/catalog-model';
import { buildRepositoryRows, isCovered, selectUncoveredRepositories, summarizeCoverage } from './coverage';
import { DEFAULT_PERIMETER } from './perimeter';
import { ALL_REPOSITORY_KINDS } from './labels';
import { GithubRepositoryInfo, Perimeter, RepositoryKind, RepositoryLocation, RepositoryRow } from '../types';

const ORG = 'happn-app';

/** Every kind and every language, unless a test narrows one dimension. */
function perimeter(overrides: Partial<Perimeter> = {}): Perimeter {
  return { languages: [], kinds: ALL_REPOSITORY_KINDS, ...overrides };
}

function excluding(...kinds: RepositoryKind[]): Perimeter {
  return perimeter({ kinds: ALL_REPOSITORY_KINDS.filter(kind => !kinds.includes(kind)) });
}

function location(repo: string): RepositoryLocation {
  return {
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
    owner: ORG,
    url: `https://github.com/${ORG}/${name}`,
    isPrivate: true,
    isArchived: false,
    isFork: false,
    hasDefaultBranch: true,
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

  it('reports unknown when a tracked repository is absent from the GitHub response', () => {
    // A rename between the last provider sync and now: the Location survives, GitHub knows nothing
    // about that name any more, so nothing can be said about its file.
    const rows = rowsFor([location('renamed')], [], [githubRepo('other')]);

    expect(rows.find(row => row.repo === 'renamed')).toMatchObject({ status: 'unknown', isTracked: true });
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

  it('counts a Location the catalog-info.yaml declares by hand', () => {
    // Unlike the generated one, this Location is a product of the file, so a repository whose
    // catalog-info.yaml only declares Locations is integrated rather than drifting.
    const declaredLocation = child('esctl', 'catalog-info.yaml', 'Location');

    const [row] = rowsFor([location('esctl')], [declaredLocation], [githubRepo('esctl', { hasRootCatalogInfo: true })]);

    expect(row).toMatchObject({ status: 'integrated', entityCount: 1, entityKinds: ['Location'] });
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

    expect(summarizeCoverage(rows, perimeter())).toMatchObject({
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

    const stats = summarizeCoverage(rowsFor(locations, children, []), perimeter());

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

    expect(summarizeCoverage(rows, perimeter())).toMatchObject({
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

    expect(summarizeCoverage(rows, perimeter({ languages: ['Java', 'Kotlin'] }))).toMatchObject({
      total: 2,
      integrated: 1,
      uncoveredPercentage: 50,
    });
    expect(summarizeCoverage(rows, perimeter())).toMatchObject({ total: 3, integrated: 1, uncoveredPercentage: 66.7 });
  });

  it('sums the entities of the repositories in scope only', () => {
    const rows = rowsFor(
      [location('java-repo'), location('go-repo')],
      [child('java-repo', 'catalog-info.yaml'), child('go-repo', 'catalog-info.yaml')],
      [githubRepo('java-repo', { primaryLanguage: 'Java' }), githubRepo('go-repo', { primaryLanguage: 'Go' })],
    );

    expect(summarizeCoverage(rows, perimeter({ languages: ['Java', 'Kotlin'] })).entityCount).toBe(1);
    expect(summarizeCoverage(rows, perimeter()).entityCount).toBe(2);
  });

  it('reports zeroes rather than NaN when nothing is in scope', () => {
    expect(summarizeCoverage([], perimeter({ languages: ['Java', 'Kotlin'] }))).toMatchObject({
      total: 0,
      uncoveredPercentage: 0,
      coveredPercentage: 0,
    });
  });

  it('counts every kind when the selection asks for every kind', () => {
    const rows = rowsFor(
      [location('carbon')],
      [child('carbon', 'catalog-info.yaml')],
      [githubRepo('carbon'), githubRepo('archived', { isArchived: true }), githubRepo('a-fork', { isFork: true })],
    );

    expect(summarizeCoverage(rows, perimeter())).toMatchObject({ total: 3, integrated: 1, uncoveredPercentage: 66.7 });
  });

  it('measures only the active repositories under the default perimeter', () => {
    const rows = rowsFor(
      [location('carbon')],
      [child('carbon', 'catalog-info.yaml')],
      [githubRepo('carbon'), githubRepo('archived', { isArchived: true }), githubRepo('a-fork', { isFork: true })],
    );

    // Neither the archived repository nor the fork can ever be onboarded, so neither belongs in the
    // figure the page opens on.
    expect(summarizeCoverage(rows, DEFAULT_PERIMETER)).toMatchObject({
      total: 1,
      integrated: 1,
      uncoveredPercentage: 0,
    });
  });

  it('drops both the rows and the denominator when a kind leaves the selection', () => {
    const rows = rowsFor(
      [location('carbon')],
      [child('carbon', 'catalog-info.yaml')],
      [githubRepo('carbon'), githubRepo('archived', { isArchived: true }), githubRepo('a-fork', { isFork: true })],
    );

    expect(summarizeCoverage(rows, excluding('archived'))).toMatchObject({ total: 2, uncoveredPercentage: 50 });
    expect(summarizeCoverage(rows, excluding('archived', 'fork'))).toMatchObject({
      total: 1,
      integrated: 1,
      uncoveredPercentage: 0,
    });
  });

  it('keeps a repository that is both archived and a fork under either kind', () => {
    // Selecting Fork means "show me the forks", so an archived fork is one of them.
    const rows = rowsFor([], [], [githubRepo('both', { isArchived: true, isFork: true }), githubRepo('walked')]);

    expect(summarizeCoverage(rows, perimeter({ kinds: ['archived'] })).total).toBe(1);
    expect(summarizeCoverage(rows, perimeter({ kinds: ['fork'] })).total).toBe(1);
    expect(summarizeCoverage(rows, perimeter({ kinds: ['active'] })).total).toBe(1);
  });

  it('counts unknown repositories as uncovered when enrichment failed', () => {
    const rows = rowsFor([location('a'), location('b')], [child('a', 'catalog-info.yaml')], [], false);

    expect(summarizeCoverage(rows, perimeter())).toMatchObject({
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

    expect(selectUncoveredRepositories(rows, perimeter(), 10).map(row => row.repo)).toEqual([
      'drifting',
      'fresh',
      'stale',
    ]);
  });

  it('excludes covered repositories and honours the limit', () => {
    const rows = rowsFor(
      [location('a'), location('b'), location('c')],
      [child('a', 'catalog-info.yaml')],
      [githubRepo('a'), githubRepo('b'), githubRepo('c')],
    );

    expect(selectUncoveredRepositories(rows, perimeter(), 1)).toHaveLength(1);
    expect(selectUncoveredRepositories(rows, perimeter(), 10).map(row => row.repo)).not.toContain('a');
  });

  it('leaves out repositories the provider will never walk, whatever the perimeter says', () => {
    // Onboarding one cannot put it in the catalog, so suggesting it would not be a thing to do.
    const rows = rowsFor(
      [],
      [],
      [
        githubRepo('archived', { isArchived: true, pushedAt: '2026-07-30T00:00:00Z' }),
        githubRepo('a-fork', { isFork: true, pushedAt: '2026-07-29T00:00:00Z' }),
        githubRepo('empty', { hasDefaultBranch: false, pushedAt: '2026-07-28T00:00:00Z' }),
        githubRepo('onboardable', { pushedAt: '2026-01-01T00:00:00Z' }),
      ],
    );

    expect(selectUncoveredRepositories(rows, perimeter(), 10).map(row => row.repo)).toEqual(['onboardable']);
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

describe('the union with GitHub', () => {
  it('lists a repository GitHub reports and the provider has no Location for', () => {
    const rows = rowsFor(
      [location('carbon')],
      [],
      [githubRepo('carbon'), githubRepo('happn-legacy', { isArchived: true })],
    );

    expect(rows.map(row => [row.repo, row.isTracked])).toEqual([
      ['carbon', true],
      ['happn-legacy', false],
    ]);
  });

  it('reads the organization of an untracked repository from its GitHub owner', () => {
    const [row] = rowsFor([], [], [githubRepo('happn-legacy', { owner: 'happn-app', isFork: true })]);

    expect(row).toMatchObject({ org: 'happn-app', url: `https://github.com/${ORG}/happn-legacy` });
  });

  it('names every reason the provider skips a repository', () => {
    const rows = rowsFor(
      [],
      [],
      [
        githubRepo('archived', { isArchived: true }),
        githubRepo('a-fork', { isFork: true }),
        githubRepo('empty', { hasDefaultBranch: false }),
        githubRepo('archived-fork', { isArchived: true, isFork: true }),
        githubRepo('walked'),
      ],
    );

    expect(rows.map(row => [row.repo, row.providerSkips])).toEqual([
      ['a-fork', ['fork']],
      ['archived', ['archived']],
      ['archived-fork', ['archived', 'fork']],
      ['empty', ['no-default-branch']],
      ['walked', []],
    ]);
  });

  it('follows GitHub rather than a stale Location for a repository archived since the last sync', () => {
    const rows = rowsFor(
      [location('carbon')],
      [child('carbon', 'catalog-info.yaml')],
      [githubRepo('carbon', { isArchived: true })],
    );

    expect(rows[0]).toMatchObject({ isTracked: true, status: 'integrated', providerSkips: ['archived'] });
  });

  it('reports an untracked repository with no skip reason, which is a genuine gap', () => {
    const [row] = rowsFor([], [], [githubRepo('created-yesterday')]);

    expect(row).toMatchObject({ isTracked: false, providerSkips: [], status: 'not-integrated' });
  });

  it('has no untracked rows at all when GitHub could not be reached', () => {
    const rows = rowsFor([location('carbon')], [], [], false);

    expect(rows.map(row => row.repo)).toEqual(['carbon']);
    expect(rows[0].providerSkips).toEqual([]);
  });
});
