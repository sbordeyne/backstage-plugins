import { coreServices, createBackendModule } from '@backstage/backend-plugin-api';
import { techInsightsFactRetrieversExtensionPoint } from '@backstage-community/plugin-tech-insights-node';
import { jiraFactRetriever } from './retrievers/jiraFactRetriever';

export const techInsightsModuleJira = createBackendModule({
  pluginId: 'tech-insights',
  moduleId: 'jira',
  register(reg) {
    reg.registerInit({
      deps: {
        techInsights: techInsightsFactRetrieversExtensionPoint,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
      },
      async init({ techInsights, config, logger }) {
        if (!config.has('techInsights.jira')) {
          logger.warn('techInsights.jira config not found — jiraFactRetriever will not be registered');
          return;
        }
        techInsights.addFactRetrievers({ jiraFactRetriever });
      },
    });
  },
});
