import { renderHook } from '@testing-library/react';
import { JsonObject } from '@backstage/types';
import { configApiRef } from '@backstage/core-plugin-api';
import { mockApis, TestApiProvider, wrapInTestApp } from '@backstage/test-utils';
import { useIntegrateTemplateLink } from './useIntegrateTemplateLink';
import { selectedTemplateRouteRef } from '../routes';
import { RepositoryRow } from '../types';

const WIZARD_PATH = '/create/templates/:namespace/:templateName';

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
};

/** The prefill the wizard parses on mount, read back out of the query string. */
function prefillOf(link: string): JsonObject {
  const formData = new URL(link, 'http://localhost').searchParams.get('formData');
  return JSON.parse(formData ?? '{}');
}

function renderLink(options: { config: JsonObject; mountWizard?: boolean }) {
  const { config, mountWizard = true } = options;

  return renderHook(() => useIntegrateTemplateLink(), {
    wrapper: ({ children }) =>
      wrapInTestApp(
        <TestApiProvider apis={[[configApiRef, mockApis.config({ data: config })]]}>{children}</TestApiProvider>,
        mountWizard ? { mountedRoutes: { [WIZARD_PATH]: selectedTemplateRouteRef } } : undefined,
      ),
  }).result.current;
}

describe('useIntegrateTemplateLink', () => {
  it('builds the wizard link for a repository', () => {
    const link = renderLink({
      config: { integratedRepositories: { onboardingTemplateRef: 'template:default/onboard-repository' } },
    });

    const href = link?.(SALT) ?? '';
    expect(new URL(href, 'http://localhost').pathname).toBe('/create/templates/default/onboard-repository');
    // Encoded as one search parameter, so the inner `&` of repoUrl cannot split the query string.
    expect(prefillOf(href)).toEqual({
      repoUrl: 'github.com?owner=happn-app&repo=salt',
      name: 'salt',
      defaultBranch: 'master',
    });
  });

  it('prefills the repository default branch, which the TechDocs workflow publishes from', () => {
    const link = renderLink({
      config: { integratedRepositories: { onboardingTemplateRef: 'template:default/onboard-repository' } },
    });

    expect(prefillOf(link?.({ ...SALT, defaultBranch: 'main' }) ?? '')).toMatchObject({ defaultBranch: 'main' });
  });

  it('falls back to master when GitHub reported no default branch', () => {
    const link = renderLink({
      config: { integratedRepositories: { onboardingTemplateRef: 'template:default/onboard-repository' } },
    });

    expect(prefillOf(link?.({ ...SALT, defaultBranch: undefined }) ?? '')).toMatchObject({ defaultBranch: 'master' });
  });

  it('prefills the configured parameters instead of the stock ones', () => {
    const link = renderLink({
      config: {
        integratedRepositories: {
          onboardingTemplateRef: 'template:default/onboard-repository',
          onboardingTemplateDefaults: {
            repository: '{{ org }}/{{ repo }}',
            branch: '{{ defaultBranch | trunk }}',
            createPullRequest: true,
          },
        },
      },
    });

    expect(prefillOf(link?.(SALT) ?? '')).toEqual({
      repository: 'happn-app/salt',
      branch: 'trunk',
      createPullRequest: true,
    });
  });

  it('defaults the kind and honours a namespaced template ref', () => {
    const link = renderLink({
      config: { integratedRepositories: { onboardingTemplateRef: 'tools/onboard-repository' } },
    });

    expect(new URL(link?.(SALT) ?? '', 'http://localhost').pathname).toBe('/create/templates/tools/onboard-repository');
  });

  it('offers nothing when no template is configured', () => {
    expect(renderLink({ config: {} })).toBeUndefined();
  });

  it('offers nothing when the wizard route is not bound', () => {
    const link = renderLink({
      config: { integratedRepositories: { onboardingTemplateRef: 'template:default/onboard-repository' } },
      mountWizard: false,
    });

    expect(link).toBeUndefined();
  });
});
