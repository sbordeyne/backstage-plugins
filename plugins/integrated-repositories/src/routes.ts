import { createExternalRouteRef, createRouteRef } from '@backstage/core-plugin-api';

export const rootRouteRef = createRouteRef({
  id: 'integrated-repositories',
});

/**
 * The scaffolder's template wizard, which the table links to with the repository prefilled.
 *
 * Optional on purpose: when the app does not bind it, `useRouteRef` returns undefined and the table
 * drops the onboarding column rather than rendering a link that goes nowhere.
 */
export const selectedTemplateRouteRef = createExternalRouteRef({
  id: 'integrated-repositories:selected-template',
  params: ['namespace', 'templateName'],
  optional: true,
  defaultTarget: 'scaffolder.selectedTemplate',
});
