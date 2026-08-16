import { parseEntityRef } from '@backstage/catalog-model';
import { ConfigApi } from '@backstage/core-plugin-api';

const CONFIG_ROOT = 'integratedRepositories';

/** The onboarding template, in the shape the scaffolder's wizard route expects. */
export interface OnboardingTemplate {
  namespace: string;
  templateName: string;
}

/**
 * The GitHub organization to enumerate, or undefined when it is not configured.
 *
 * A missing organization is not fatal: the enrichment stage fails on its own and the page falls back
 * to the catalog-only view, which is more useful than refusing to render.
 */
export function readOrganization(configApi: ConfigApi): string | undefined {
  return configApi.getOptionalString(`${CONFIG_ROOT}.organization`);
}

/**
 * The languages selected when the page opens. Empty means all languages, which is the default: the
 * page is meant to describe the whole organization unless an installation narrows it deliberately.
 */
export function readDefaultLanguages(configApi: ConfigApi): string[] {
  return configApi.getOptionalStringArray(`${CONFIG_ROOT}.defaultLanguages`) ?? [];
}

/**
 * The software template offered for uncovered repositories, or undefined when none is configured.
 *
 * An absent template is not an error: the table simply offers no onboarding action, which is the
 * right behaviour for an installation that has not published one. A ref that cannot be parsed is
 * treated the same way — `parseEntityRef` throws, and letting that escape a render would take the
 * whole page down over a typo in an optional key.
 */
export function readOnboardingTemplate(configApi: ConfigApi): OnboardingTemplate | undefined {
  const ref = configApi.getOptionalString(`${CONFIG_ROOT}.onboardingTemplateRef`);
  if (!ref) {
    return undefined;
  }

  try {
    const { namespace, name } = parseEntityRef(ref, { defaultKind: 'template', defaultNamespace: 'default' });
    return { namespace, templateName: name };
  } catch {
    return undefined;
  }
}
