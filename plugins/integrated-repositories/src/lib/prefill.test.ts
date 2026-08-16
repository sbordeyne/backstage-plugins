import { buildTemplatePrefill } from './prefill';
import { RepositoryRow } from '../types';

const SALT: RepositoryRow = {
  repo: 'salt',
  org: 'happn-app',
  url: 'https://github.com/happn-app/salt',
  status: 'not-integrated',
  catalogInfoPaths: [],
  entityCount: 0,
  entityKinds: [],
  isTracked: true,
  providerSkips: [],
  defaultBranch: 'main',
  primaryLanguage: 'Python',
};

describe('buildTemplatePrefill', () => {
  it('interpolates the repository into the configured strings', () => {
    expect(
      buildTemplatePrefill({ repoUrl: 'github.com?owner={{ org }}&repo={{ repo }}', name: '{{repo}}' }, SALT),
    ).toEqual({
      repoUrl: 'github.com?owner=happn-app&repo=salt',
      name: 'salt',
    });
  });

  it('exposes the fields derivable from a repository', () => {
    expect(
      buildTemplatePrefill({ value: '{{ url }} {{ defaultBranch }} {{ primaryLanguage }} {{ status }}' }, SALT),
    ).toEqual({ value: 'https://github.com/happn-app/salt main Python not-integrated' });
  });

  it('falls back when the field is missing', () => {
    expect(
      buildTemplatePrefill({ branch: '{{ defaultBranch | master }}' }, { ...SALT, defaultBranch: undefined }),
    ).toEqual({ branch: 'master' });
  });

  it('prefers the repository over the fallback', () => {
    expect(buildTemplatePrefill({ branch: '{{ defaultBranch | master }}' }, SALT)).toEqual({ branch: 'main' });
  });

  it('empties a placeholder naming no known field, rather than leaving it literal in the form', () => {
    expect(buildTemplatePrefill({ owner: '{{ team }}' }, SALT)).toEqual({ owner: '' });
  });

  it('leaves non-string values alone and walks into lists and nested objects', () => {
    expect(
      buildTemplatePrefill(
        {
          dryRun: true,
          retries: 3,
          tags: ['{{ primaryLanguage }}', 'onboarding'],
          repository: { name: '{{ repo }}', private: false },
        },
        SALT,
      ),
    ).toEqual({
      dryRun: true,
      retries: 3,
      tags: ['Python', 'onboarding'],
      repository: { name: 'salt', private: false },
    });
  });
});
