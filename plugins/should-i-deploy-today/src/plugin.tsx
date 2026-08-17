import { createFrontendPlugin } from '@backstage/frontend-plugin-api';
import { HomePageWidgetBlueprint } from '@backstage/plugin-home-react/alpha';

import { rootRouteRef } from './routes';

const widget = HomePageWidgetBlueprint.make({
  name: 'should-i-deploy-today',
  params: {
    name: 'Should I deploy today?',
    description: 'A simple widget to check if you should deploy today.',
    layout: {
      height: {
        minRows: 4,
      },
      width: {
        minColumns: 6,
      },
    },
    components: () =>
      import('./components/ShouldIDeploy/ShouldIDeploy').then(m => ({
        Content: m.ShouldIDeploy,
      })),
  },
});

export const shouldIDeployTodayPlugin = createFrontendPlugin({
  pluginId: 'should-i-deploy-today',
  extensions: [widget],
  routes: {
    root: rootRouteRef,
  },
});
