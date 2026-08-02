import { coreServices, createBackendModule } from '@backstage/backend-plugin-api';
import { techInsightsFactRetrieversExtensionPoint } from '@backstage-community/plugin-tech-insights-node';
import { stackFactRetriever } from './retrievers/stackFactRetriever';

export const techInsightsModuleStack = createBackendModule({
  pluginId: 'tech-insights',
  moduleId: 'stack',
  register(reg) {
    reg.registerInit({
      deps: {
        techInsights: techInsightsFactRetrieversExtensionPoint,
        config: coreServices.rootConfig,
      },
      async init({ techInsights, config }) {
        if (!config.has('integrations.github')) {
          throw new Error('stackFactRetriever requires integrations.github to be configured');
        }
        techInsights.addFactRetrievers({ stackFactRetriever });
      },
    });
  },
});
