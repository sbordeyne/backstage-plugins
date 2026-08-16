import { ConfigApi } from '@backstage/core-plugin-api';
import { JsonObject } from '@backstage/types';
import { mockApis } from '@backstage/test-utils';
import { readDefaultLanguages, readOnboardingTemplate, readOrganization } from './config';

function configApi(integratedRepositories: JsonObject | undefined): ConfigApi {
  return mockApis.config({ data: { integratedRepositories } });
}

describe('readOrganization', () => {
  it('reads the configured organization', () => {
    expect(readOrganization(configApi({ organization: 'happn-app' }))).toBe('happn-app');
  });

  it('is undefined when the whole block is absent', () => {
    expect(readOrganization(configApi(undefined))).toBeUndefined();
  });
});

describe('readDefaultLanguages', () => {
  it('reads the configured languages', () => {
    expect(readDefaultLanguages(configApi({ defaultLanguages: ['Java', 'Kotlin'] }))).toEqual(['Java', 'Kotlin']);
  });

  it('falls back to the empty selection, which means all languages', () => {
    expect(readDefaultLanguages(configApi({}))).toEqual([]);
  });
});

describe('readOnboardingTemplate', () => {
  it('splits a full entity ref', () => {
    expect(readOnboardingTemplate(configApi({ onboardingTemplateRef: 'template:default/onboard-repository' }))).toEqual(
      {
        namespace: 'default',
        templateName: 'onboard-repository',
      },
    );
  });

  it('defaults the kind and the namespace', () => {
    expect(readOnboardingTemplate(configApi({ onboardingTemplateRef: 'onboard-repository' }))).toEqual({
      namespace: 'default',
      templateName: 'onboard-repository',
    });
  });

  it('is undefined when no template is configured', () => {
    expect(readOnboardingTemplate(configApi({}))).toBeUndefined();
  });

  it('is undefined for a ref that cannot be parsed, rather than throwing through the render', () => {
    expect(readOnboardingTemplate(configApi({ onboardingTemplateRef: 'template:default/' }))).toBeUndefined();
  });
});
