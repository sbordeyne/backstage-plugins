import { useMemo } from 'react';
import { configApiRef, useApi, useRouteRef } from '@backstage/core-plugin-api';
import { readOnboardingTemplate } from '../config';
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
 * Only the repository is prefilled. Owner, system and lifecycle are not derivable from a repository,
 * and a wrong default in a picker is worse than an empty one.
 */
export function useIntegrateTemplateLink(): IntegrateTemplateLink | undefined {
  const configApi = useApi(configApiRef);
  const templateRoute = useRouteRef(selectedTemplateRouteRef);
  const template = useMemo(() => readOnboardingTemplate(configApi), [configApi]);

  return useMemo(() => {
    if (!templateRoute || !template) {
      return undefined;
    }

    return (row: RepositoryRow): string => {
      // Keys are the template's own parameter names. `repoUrl` is the shape `RepoUrlPicker` parses.
      const formData = {
        repoUrl: `github.com?owner=${row.org}&repo=${row.repo}`,
        name: row.repo,
        defaultBranch: row.defaultBranch ?? 'master',
      };
      // Encoding the JSON as a search parameter escapes its inner `&`, which would otherwise split
      // the query string.
      const query = new URLSearchParams({ formData: JSON.stringify(formData) });
      return `${templateRoute(template)}?${query.toString()}`;
    };
  }, [templateRoute, template]);
}
