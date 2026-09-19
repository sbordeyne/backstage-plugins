import { TestDatabases, mockServices } from '@backstage/backend-test-utils';
import { join } from 'path';

import { KubespecStore } from '../database/KubespecStore';
import { MetadataLoader } from './MetadataLoader';

jest.setTimeout(60_000);

const fixtures = join(__dirname, '__fixtures__', 'metadata');

describe('MetadataLoader', () => {
  const databases = TestDatabases.create({ ids: ['SQLITE_3'], disableDocker: true });

  async function load(directory: string) {
    const knex = await databases.init('SQLITE_3');
    const store = await KubespecStore.create({ database: mockServices.database({ knex }) });
    const result = await new MetadataLoader({ store, logger: mockServices.logger.mock(), directory }).load();
    return { store, result };
  }

  it('reads examples and links, keyed by source, apiVersion and kind', async () => {
    const { store, result } = await load(fixtures);

    expect(result.warnings).toEqual([]);
    expect(result.examples).toBe(3);
    expect(result.links).toBe(2);

    const metadata = await store.getMetadata('kubernetes', 'apps/v1', 'Deployment');

    expect(metadata.examples).toEqual([
      expect.objectContaining({
        ordinal: 1,
        slug: 'basic',
        title: 'An NGINX deployment with 3 replicas',
        description: 'The label `app:nginx` matches the pods to the Deployment',
      }),
      expect.objectContaining({ ordinal: 2, slug: 'strategy', title: 'Rolling update strategy' }),
    ]);

    // The YAML is served on its own, so nothing on the page renders markdown.
    expect(metadata.examples[0].content).toBe('apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: nginx');
    expect(metadata.examples[1].description).toBeUndefined();

    expect(metadata.links).toEqual([
      expect.objectContaining({ name: 'Kubernetes docs: Deployments' }),
      expect.objectContaining({ name: 'kubectl reference' }),
    ]);
  });

  it('handles an apiVersion that contains a slash', async () => {
    const { store } = await load(fixtures);

    const metadata = await store.getMetadata('cert-manager', 'cert-manager.io/v1', 'Certificate');
    expect(metadata.examples).toHaveLength(1);
    expect(metadata.examples[0].content).toContain('kind: Certificate');
  });

  it('matches a kind case-insensitively, since the directory is lowercased', async () => {
    const { store } = await load(fixtures);
    expect((await store.getMetadata('kubernetes', 'apps/v1', 'deployment')).examples).toHaveLength(2);
  });

  it('returns empty metadata for a kind nobody has written about', async () => {
    const { store } = await load(fixtures);
    expect(await store.getMetadata('kubernetes', 'v1', 'Pod')).toEqual({ examples: [], links: [] });
  });

  it('ignores its own documentation files', async () => {
    const { result } = await load(fixtures);
    // The README beside the content is not an example, and must not be reported
    // as a misplaced one either.
    expect(result.warnings).toEqual([]);
  });

  it('treats a missing directory as "no examples", not an error', async () => {
    const { result } = await load(join(fixtures, 'does-not-exist'));

    expect(result).toMatchObject({ examples: 0, links: 0, warnings: [] });
  });

  it('replaces everything on each load, so a deleted file disappears', async () => {
    const knex = await databases.init('SQLITE_3');
    const store = await KubespecStore.create({ database: mockServices.database({ knex }) });
    const logger = mockServices.logger.mock();

    await new MetadataLoader({ store, logger, directory: fixtures }).load();
    await new MetadataLoader({ store, logger, directory: join(fixtures, 'does-not-exist') }).load();

    expect(await store.getMetadata('kubernetes', 'apps/v1', 'Deployment')).toEqual({ examples: [], links: [] });
  });
});
