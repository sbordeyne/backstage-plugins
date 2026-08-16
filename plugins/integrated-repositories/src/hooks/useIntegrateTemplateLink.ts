import { useMemo } from 'react';
import { configApiRef, useApi, useRouteRef } from '@backstage/core-plugin-api';
import { readOnboardingTemplate, readOnboardingTemplateDefaults } from '../config';
import { buildTemplatePrefill } from '../lib/prefill';
import { selectedTemplateRouteRef } from '../routes';
import { RepositoryRow } from '../types';

/** Builds the onboarding wizard link for one repository. */
export type IntegrateTemplateLink = (row: RepositoryRow) => string;

/**
 * The scaffolder wizard link for a repository, prefilled through the `formData` query parameter the
 * wizard parses on mount.
 *
 * Undefined when the wizard route is unbound or no template is configured, so callers drop the
 * affordance entirely rather than offering an action that cannot work.
 *
 * Which fields are prefilled is configuration: `integratedRepositories.onboardingTemplateDefaults`
 * keys the values by the template's own parameter names and interpolates the repository into them.
 */
export function useIntegrateTemplateLink(): IntegrateTemplateLink | undefined {
  const configApi = useApi(configApiRef);
  const templateRoute = useRouteRef(selectedTemplateRouteRef);
  const template = useMemo(() => readOnboardingTemplate(configApi), [configApi]);
  const defaults = useMemo(() => readOnboardingTemplateDefaults(configApi), [configApi]);

  return useMemo(() => {
    if (!templateRoute || !template) {
      return undefined;
    }

    return (row: RepositoryRow): string => {
      const formData = buildTemplatePrefill(defaults, row);
      // Encoding the JSON as a search parameter escapes its inner `&`, which would otherwise split
      // the query string.
      const query = new URLSearchParams({ formData: JSON.stringify(formData) });
      return `${templateRoute(template)}?${query.toString()}`;
    };
  }, [templateRoute, template, defaults]);
}
