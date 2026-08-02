import { CatalogClient } from '@backstage/catalog-client';
import { Entity } from '@backstage/catalog-model';
import { DateTime } from 'luxon';
import type { FactRetriever, TechInsightFact } from '@backstage-community/plugin-tech-insights-node';
import { JiraClient } from './jiraClient';

const JIRA_PROJECT_KEY_ANNOTATION = 'jira/project-key';

export const jiraFactRetriever: FactRetriever = {
  id: 'jiraFactRetriever',
  version: '0.1.0',
  title: 'Jira Metrics',
  description: 'Retrieves Jira project health metrics (bugs, tech debt, cycle time) per entity',
  entityFilter: [{ kind: ['component'] }],
  schema: {
    hasJiraProject: {
      type: 'boolean',
      description: 'Entity is linked to a Jira project via jira/project-key annotation',
    },
    openBugCount: {
      type: 'integer',
      description: 'Number of open unresolved bugs in the Jira project',
    },
    openBlockerBugCount: {
      type: 'integer',
      description: 'Number of open bugs with Blocker or Critical priority',
    },
    openTechDebtCount: {
      type: 'integer',
      description: 'Number of open Tech Debt and Improvement issues',
    },
    avgCycleTimeDays: {
      type: 'float',
      description: 'Average days from creation to resolution (issues resolved in last 90 days)',
    },
    jiraProjectKey: {
      type: 'string',
      description: 'The Jira project key linked to this entity',
    },
  },

  handler: async ({ config, discovery, auth, logger }) => {
    const baseUrl = config.getString('techInsights.jira.baseUrl');
    const token = config.getString('techInsights.jira.token');
    const jira = new JiraClient(baseUrl, token);

    const { token: catalogToken } = await auth.getPluginRequestToken({
      onBehalfOf: await auth.getOwnServiceCredentials(),
      targetPluginId: 'catalog',
    });
    const catalog = new CatalogClient({ discoveryApi: discovery });
    const { items: entities } = await catalog.getEntities({ filter: [{ kind: 'Component' }] }, { token: catalogToken });

    const results: TechInsightFact[] = [];

    for (const entity of entities) {
      const projectKey = entity.metadata.annotations?.[JIRA_PROJECT_KEY_ANNOTATION];

      if (!projectKey) {
        results.push(emptyFact(entity));
        continue;
      }

      const project = await jira.getProject(projectKey);
      if (!project) {
        logger.warn(`jiraFactRetriever: project not found for ${entity.metadata.name} (key=${projectKey})`);
        results.push(emptyFact(entity, projectKey));
        continue;
      }

      try {
        const [bugs, blockers, techDebt, cycleTimeResult] = await Promise.all([
          jira.searchIssues(`project = "${projectKey}" AND issuetype = Bug AND resolution = Unresolved`),
          jira.searchIssues(
            `project = "${projectKey}" AND issuetype = Bug AND priority in (Blocker, Critical) AND resolution = Unresolved`,
          ),
          jira.searchIssues(
            `project = "${projectKey}" AND issuetype in ("Tech Debt", Improvement) AND resolution = Unresolved`,
          ),
          jira.searchIssues(`project = "${projectKey}" AND resolution = Done AND resolutiondate >= -90d`, 100),
        ]);

        results.push({
          entity: entityRef(entity),
          facts: {
            hasJiraProject: true,
            openBugCount: bugs.total,
            openBlockerBugCount: blockers.total,
            openTechDebtCount: techDebt.total,
            avgCycleTimeDays: computeAvgCycleTimeDays(cycleTimeResult.issues),
            jiraProjectKey: projectKey,
          },
          timestamp: DateTime.now(),
        });
      } catch (err) {
        logger.error(`jiraFactRetriever: error processing ${entity.metadata.name}: ${err}`);
        results.push(emptyFact(entity, projectKey));
      }
    }

    return results;
  },
};

function entityRef(entity: Entity) {
  return {
    namespace: entity.metadata.namespace ?? 'default',
    kind: entity.kind,
    name: entity.metadata.name,
  };
}

function emptyFact(entity: Entity, projectKey = ''): TechInsightFact {
  return {
    entity: entityRef(entity),
    facts: {
      hasJiraProject: false,
      openBugCount: 0,
      openBlockerBugCount: 0,
      openTechDebtCount: 0,
      avgCycleTimeDays: 0,
      jiraProjectKey: projectKey,
    },
    timestamp: DateTime.now(),
  };
}

function computeAvgCycleTimeDays(
  issues: Array<{ fields: { created: string; resolutiondate?: string | null } }>,
): number {
  const cycleTimes = issues
    .filter(i => i.fields.resolutiondate)
    .map(i => {
      const created = DateTime.fromISO(i.fields.created);
      const resolved = DateTime.fromISO(i.fields.resolutiondate!);
      return resolved.diff(created, 'days').days;
    })
    .filter(d => d >= 0);

  if (!cycleTimes.length) return 0;
  return cycleTimes.reduce((a, b) => a + b, 0) / cycleTimes.length;
}
