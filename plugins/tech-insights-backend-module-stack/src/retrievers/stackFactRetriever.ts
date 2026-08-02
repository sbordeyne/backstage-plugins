import { CatalogClient } from '@backstage/catalog-client';
import { Entity } from '@backstage/catalog-model';
import { UrlReaderService } from '@backstage/backend-plugin-api';
import { ScmIntegrations, DefaultGithubCredentialsProvider } from '@backstage/integration';
import { Octokit } from '@octokit/rest';
import type {
  FactRetriever,
  FactRetrieverContext,
  TechInsightFact,
} from '@backstage-community/plugin-tech-insights-node';
import { parsePom } from './parsers/parsePom';
import { parseBuildGradle } from './parsers/parseBuildGradle';
import { parsePackageJson } from './parsers/parsePackageJson';
import { parseGoMod } from './parsers/parseGoMod';

const GITHUB_SLUG_ANNOTATION = 'github.com/project-slug';

export const stackFactRetriever: FactRetriever = {
  id: 'stackFactRetriever',
  version: '0.1.0',
  title: 'Tech Stack',
  description: 'Detects build tool, language version, framework and metrics library from GitHub repository files',
  entityFilter: [{ kind: ['component'] }],
  schema: {
    primaryLanguage: {
      type: 'string',
      description: 'Primary language reported by GitHub (e.g. Java, TypeScript, Go)',
    },
    buildTool: {
      type: 'string',
      description: 'Build tool: maven | gradle | npm | yarn | go | unknown',
    },
    languageVersion: {
      type: 'string',
      description: 'Language/runtime version extracted from build file',
    },
    framework: {
      type: 'string',
      description: 'Framework: spring-boot | express | nestjs | unknown',
    },
    metricsFramework: {
      type: 'string',
      description: 'Metrics library: micrometer | prometheus-client | unknown',
    },
    springBootVersion: {
      type: 'string',
      description: 'Spring Boot version when applicable, empty string otherwise',
    },
    hasSpringBoot: {
      type: 'boolean',
      description: 'Entity uses the Spring Boot framework',
    },
    hasMicrometer: {
      type: 'boolean',
      description: 'Entity uses Micrometer metrics library',
    },
    hasGithubSlug: {
      type: 'boolean',
      description: 'Entity has a github.com/project-slug annotation',
    },
  },

  handler: async (ctx: FactRetrieverContext) => {
    const { config, discovery, auth, urlReader, logger } = ctx;

    const integrations = ScmIntegrations.fromConfig(config);
    const credentialsProvider = DefaultGithubCredentialsProvider.fromIntegrations(integrations);

    const { token: catalogToken } = await auth.getPluginRequestToken({
      onBehalfOf: await auth.getOwnServiceCredentials(),
      targetPluginId: 'catalog',
    });
    const catalog = new CatalogClient({ discoveryApi: discovery });
    const { items: entities } = await catalog.getEntities({ filter: [{ kind: 'Component' }] }, { token: catalogToken });

    const results: TechInsightFact[] = [];

    for (const entity of entities) {
      const slug = entity.metadata.annotations?.[GITHUB_SLUG_ANNOTATION];

      if (!slug) {
        results.push(unknownFact(entity, false));
        continue;
      }

      const parts = slug.split('/');
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        logger.warn(`stackFactRetriever: invalid github.com/project-slug "${slug}" on ${entity.metadata.name}`);
        results.push(unknownFact(entity, true));
        continue;
      }

      const [owner, repo] = parts;

      try {
        const { token: ghToken } = await credentialsProvider.getCredentials({
          url: `https://github.com/${owner}/${repo}`,
        });

        const octokit = new Octokit({ auth: ghToken });
        const { data: repoData } = await octokit.repos.get({ owner, repo });
        const primaryLanguage = repoData.language ?? 'unknown';
        const defaultBranch = repoData.default_branch ?? 'main';

        const rawBase = `https://raw.githubusercontent.com/${owner}/${repo}/${defaultBranch}`;

        const [pomResult, gradleResult, pkgJsonResult, goModResult, yarnLockResult] = await Promise.allSettled([
          readText(urlReader, `${rawBase}/pom.xml`),
          readText(urlReader, `${rawBase}/build.gradle`),
          readText(urlReader, `${rawBase}/package.json`),
          readText(urlReader, `${rawBase}/go.mod`),
          urlReader
            .readUrl(`${rawBase}/yarn.lock`)
            .then(() => true)
            .catch(() => false),
        ]);

        const pomContent = fulfilledValue(pomResult);
        const gradleContent = fulfilledValue(gradleResult);
        const pkgContent = fulfilledValue(pkgJsonResult);
        const goModContent = fulfilledValue(goModResult);
        const hasYarnLock = yarnLockResult.status === 'fulfilled' ? (yarnLockResult.value as boolean) : false;

        let buildTool = 'unknown';
        let languageVersion = '';
        let framework = 'unknown';
        let metricsFramework = 'unknown';
        let springBootVersion = '';

        if (pomContent) {
          buildTool = 'maven';
          const parsed = parsePom(pomContent);
          languageVersion = parsed.languageVersion;
          framework = parsed.framework;
          springBootVersion = parsed.springBootVersion;
          metricsFramework = parsed.metricsFramework;
        } else if (gradleContent) {
          buildTool = 'gradle';
          const parsed = parseBuildGradle(gradleContent);
          languageVersion = parsed.languageVersion;
          framework = parsed.framework;
          metricsFramework = parsed.metricsFramework;
        } else if (pkgContent) {
          const parsed = parsePackageJson(pkgContent, hasYarnLock);
          buildTool = parsed.buildTool;
          framework = parsed.framework;
          languageVersion = parsed.languageVersion;
        } else if (goModContent) {
          buildTool = 'go';
          const parsed = parseGoMod(goModContent);
          languageVersion = parsed.languageVersion;
        }

        results.push({
          entity: entityRef(entity),
          facts: {
            primaryLanguage,
            buildTool,
            languageVersion,
            framework,
            metricsFramework,
            springBootVersion,
            hasSpringBoot: framework === 'spring-boot',
            hasMicrometer: metricsFramework === 'micrometer',
            hasGithubSlug: true,
          },
        });
      } catch (err) {
        logger.error(`stackFactRetriever: error processing ${entity.metadata.name} (${slug}): ${err}`);
        results.push(unknownFact(entity, true));
      }
    }

    return results;
  },
};

async function readText(urlReader: UrlReaderService, url: string): Promise<string> {
  const response = await urlReader.readUrl(url);
  const buf = await response.buffer();
  return buf.toString('utf-8');
}

function fulfilledValue<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === 'fulfilled' ? result.value : null;
}

function entityRef(entity: Entity) {
  return {
    namespace: entity.metadata.namespace ?? 'default',
    kind: entity.kind,
    name: entity.metadata.name,
  };
}

function unknownFact(entity: Entity, hasSlug: boolean): TechInsightFact {
  return {
    entity: entityRef(entity),
    facts: {
      primaryLanguage: 'unknown',
      buildTool: 'unknown',
      languageVersion: '',
      framework: 'unknown',
      metricsFramework: 'unknown',
      springBootVersion: '',
      hasSpringBoot: false,
      hasMicrometer: false,
      hasGithubSlug: hasSlug,
    },
  };
}
