import { TestDatabases, mockServices } from '@backstage/backend-test-utils';
import { ConfigReader } from '@backstage/config';

import { readKubespecConfig } from '../config';
import { KubespecStore } from '../database/KubespecStore';
import { GithubClient } from '../github/GithubClient';
import { deserializeDefinition } from '../kube/serialize';
import { KubespecSyncWorker } from './KubespecSyncWorker';

jest.setTimeout(600_000);

/**
 * A real ingest against GitHub, skipped unless a token is supplied:
 *
 *   KUBESPEC_E2E_TOKEN="$(gh auth token)" yarn workspace @sbordeyne/backstage-plugin-kubespec-backend test realIngest
 *
 * It is the only check that exercises tag listing, the content-hash skip and the
 * manifest walk against what upstream actually publishes. CI never runs it,
 * because it needs credentials and the network.
 */
const token = process.env.KUBESPEC_E2E_TOKEN;

(token ? describe : describe.skip)('real ingest', () => {
  const databases = TestDatabases.create({ ids: ['SQLITE_3'], disableDocker: true });

  it('ingests real upstream sources', async () => {
    const knex = await databases.init('SQLITE_3');
    const store = await KubespecStore.create({ database: mockServices.database({ knex }) });

    const config = readKubespecConfig(
      new ConfigReader({
        kubespec: {
          sync: { enabled: true, maxVersionsPerTick: 6 },
          kubernetes: { minors: ['v1.33'] },
          projects: [
            {
              slug: 'gateway-api',
              name: 'Gateway API',
              repo: 'kubernetes-sigs/gateway-api',
              paths: ['config/crd/standard'],
              tags: { minVersion: 'v1.2.0', max: 2 },
            },
            {
              slug: 'cert-manager',
              name: 'cert-manager',
              repo: 'cert-manager/cert-manager',
              releaseAsset: 'cert-manager.yaml',
              tags: { regex: '^v\\d+\\.\\d+\\.\\d+$', minVersion: 'v1.16.0', max: 2 },
            },
          ],
        },
      }),
    );

    const github = new GithubClient({
      credentials: { getCredentials: async () => ({ token, type: 'token' as const }) } as never,
      logger: mockServices.logger.mock(),
    });

    const worker = new KubespecSyncWorker({ store, github, logger: mockServices.logger.mock(), config });
    const stats = await worker.syncOnce();
    // eslint-disable-next-line no-console
    console.log('STATS', JSON.stringify(stats));

    for (const source of await store.listSources()) {
      // eslint-disable-next-line no-console
      console.log(
        `SOURCE ${source.slug}: ${source.versionCount} version(s), latest ${source.latestVersion}, ${source.lastSyncStatus}`,
      );
      if (!source.latestVersion) continue;
      const version = (await store.resolveVersion(source.slug))!;
      const resources = await store.listResources(version.id);
      // eslint-disable-next-line no-console
      console.log(
        `  ${resources.length} kinds: ${resources
          .slice(0, 6)
          .map(r => `${r.apiVersionFull}/${r.kind}`)
          .join(', ')}`,
      );

      const first = resources[0];
      if (first) {
        const full = await store.getResource(version.id, {
          apiGroup: first.group,
          apiVersion: first.apiVersion,
          kind: first.kind,
        });
        const definition = deserializeDefinition(full!.definitionGzip);
        // eslint-disable-next-line no-console
        console.log(
          `  ${first.kind}: ${full!.definitionBytes} bytes raw / ${full!.definitionGzip.length} gzip, ` +
            `${definition.properties.length} top-level props, scope ${first.scope}`,
        );
      }
    }

    // A second tick must recognise everything as unchanged.
    const second = await worker.syncOnce();
    // eslint-disable-next-line no-console
    console.log('SECOND TICK', JSON.stringify(second));

    expect(stats.versionsIngested).toBeGreaterThan(0);
    expect(stats.sourcesFailed).toBe(0);
    expect(second.versionsIngested).toBe(0);
    expect(second.versionsSkippedUnchanged).toBe(stats.versionsIngested);
  });
});
