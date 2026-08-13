import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { ToolboxToolBlueprint } from '@drodil/backstage-plugin-toolbox-react';

export const gotemplateTool = ToolboxToolBlueprint.make({
  name: 'gotemplate-playground',
  params: {
    id: 'gotemplate-playground',
    displayName: 'Go template playground',
    description:
      'Render Go templates against sprig, sprout, helm or external-secrets function sets, using the real Go engine.',
    category: 'Miscellaneous',
    aliases: ['gotemplate', 'go-template', 'template', 'sprig', 'sprout', 'helm', 'external-secrets', 'eso'],
    // The engine is a multi-megabyte WebAssembly download, so the component is
    // only ever pulled in once someone opens the tool.
    loader: () => import('./components/GoTemplatePlayground').then(m => <m.GoTemplatePlayground />),
  },
});

/**
 * Frontend module registering the Go template playground into the toolbox page.
 */
export default createFrontendModule({
  pluginId: 'toolbox',
  extensions: [gotemplateTool],
});
