import { parseEntityRef } from '@backstage/catalog-model';
import { ConfigApi } from '@backstage/core-plugin-api';
import { JsonObject } from '@backstage/types';

const CONFIG_ROOT = 'integratedRepositories';

/**
 * The prefill for the stock `onboard-repository` template, used when an installation configures no
 * defaults of its own. Keys are the template's own parameter names, and `repoUrl` is the shape
 * `RepoUrlPicker` parses.
 *
 * Only the repository is prefilled. Owner, system and lifecycle are not derivable from a repository,
 * and a wrong default in a picker is worse than an empty one.
 */
export const DEFAULT_ONBOARDING_TEMPLATE_DEFAULTS: JsonObject = {
  repoUrl: 'github.com?owner={{ org }}&repo={{ repo }}',
  name: '{{ repo }}',
  defaultBranch: '{{ defaultBranch | master }}',
};

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

/**
 * The form values the onboarding wizard opens with, keyed by the template's own parameter names.
 * Strings still carry their `{{ field }}` placeholders — see `buildTemplatePrefill`.
 *
 * Falls back to {@link DEFAULT_ONBOARDING_TEMPLATE_DEFAULTS} when nothing is configured. A value
 * that is not an object is ignored the same way, because a malformed key should not cost the page
 * its onboarding action.
 */
export function readOnboardingTemplateDefaults(configApi: ConfigApi): JsonObject {
  const configured = configApi.getOptional(`${CONFIG_ROOT}.onboardingTemplateDefaults`);
  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) {
    return DEFAULT_ONBOARDING_TEMPLATE_DEFAULTS;
  }
  return configured;
}
