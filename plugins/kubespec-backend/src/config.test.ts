import { ConfigReader } from '@backstage/config';
import type { JsonObject } from '@backstage/types';

import { DEFAULT_KUBERNETES_CATEGORIES, readKubespecConfig } from './config';

function read(kubespec: JsonObject) {
  return readKubespecConfig(new ConfigReader({ kubespec }));
}

describe('readKubespecConfig', () => {
  it('applies defaults when nothing is configured', () => {
    const config = readKubespecConfig(new ConfigReader({}));

    expect(config).toMatchObject({
      pruneUnknownSources: true,
      search: { scope: 'latest', maxDepth: 6 },
      sync: { enabled: true, concurrency: 4, maxVersionsPerTick: 60, maxTickDurationMs: 600_000 },
      projects: [],
    });
    // Without pinned minors there is nothing to fetch, and guessing which
    // Kubernetes versions matter is exactly what the pinned list avoids.
    expect(config.kubernetes).toBeUndefined();
  });

  it('reads pinned Kubernetes minors and inverts the category map', () => {
    const config = read({ kubernetes: { minors: ['v1.33', 'v1.34'] } });

    expect(config.kubernetes).toMatchObject({
      slug: 'kubernetes',
      name: 'Kubernetes',
      repo: 'kubernetes/kubernetes',
      specPath: 'api/openapi-spec/swagger.json',
      minors: ['v1.33', 'v1.34'],
      defaultCategory: 'Other',
    });
    expect(config.kubernetes?.categoryByKind.Deployment).toBe('Workloads');
    expect(config.kubernetes?.categoryByKind.ClusterRole).toBe('Access Control');
    expect(Object.keys(DEFAULT_KUBERNETES_CATEGORIES)).toContain('Workloads');
  });

  it('lets config replace the category map, and orders headings by its keys', () => {
    const config = read({
      kubernetes: { minors: ['v1.33'], categories: { Everything: ['Pod', 'Deployment'] } },
    });

    expect(config.kubernetes?.categoryByKind).toEqual({ Pod: 'Everything', Deployment: 'Everything' });
    expect(config.kubernetes?.categoryOrder).toEqual(['Everything']);
  });

  it('can be turned off entirely', () => {
    expect(read({ kubernetes: { enabled: false, minors: ['v1.33'] } }).kubernetes).toBeUndefined();
  });

  it('defaults a project to first-path mode and a version cap', () => {
    const [project] = read({
      projects: [{ slug: 'istio', name: 'Istio', repo: 'istio/istio', paths: ['a', 'b'] }],
    }).projects;

    expect(project).toMatchObject({
      slug: 'istio',
      pathsMode: 'first',
      order: 0,
      tags: { excludePrerelease: true, max: 10 },
    });
  });

  it('accepts a release asset instead of paths', () => {
    const [project] = read({
      projects: [
        { slug: 'cert-manager', name: 'cert-manager', repo: 'cert-manager/cert-manager', releaseAsset: 'x.yaml' },
      ],
    }).projects;

    expect(project.releaseAsset).toBe('x.yaml');
    expect(project.paths).toEqual([]);
  });

  it('rejects a project with neither paths nor a release asset', () => {
    expect(() => read({ projects: [{ slug: 'x', name: 'X', repo: 'a/b' }] })).toThrow(
      /one of 'paths' or 'releaseAsset' is required/,
    );
  });

  it('reserves the slugs that would make a URL ambiguous', () => {
    // `kubernetes` is configured under its own key, and `core` is the path
    // segment standing in for the empty API group.
    expect(() => read({ projects: [{ slug: 'kubernetes', name: 'K', repo: 'a/b', paths: ['x'] }] })).toThrow(
      /reserved for the core API/,
    );
    expect(() => read({ projects: [{ slug: 'core', name: 'C', repo: 'a/b', paths: ['x'] }] })).toThrow(/reserved slug/);
  });

  it('rejects a malformed tag pattern at startup rather than mid-sync', () => {
    expect(() =>
      read({ projects: [{ slug: 'x', name: 'X', repo: 'a/b', paths: ['p'], tags: { regex: '[' } }] }),
    ).toThrow(/is not a valid regular expression/);
  });

  it('rejects an unknown search scope', () => {
    expect(() => read({ search: { scope: 'some' } })).toThrow(/must be 'latest' or 'all'/);
  });

  it('keeps a tick shorter than the timeout that would strand its ticket', () => {
    const config = read({});

    // These two are coupled: the scheduler never extends a running ticket and
    // only its janitor clears an expired one, so the timeout is also how long a
    // lost ticket blocks every manual sync. A tick that could outlast it would be
    // cut off, which is exactly how tickets get stranded.
    const timeout = config.sync.schedule.timeout as { minutes: number };
    expect(config.sync.maxTickDurationMs).toBeLessThan(timeout.minutes * 60_000);
  });

  it('reads a schedule, and falls back without one', () => {
    expect(read({}).sync.schedule).toMatchObject({ frequency: { hours: 24 } });

    expect(
      read({ sync: { schedule: { frequency: { hours: 6 }, timeout: { minutes: 30 } } } }).sync.schedule,
    ).toMatchObject({ frequency: { hours: 6 }, timeout: { minutes: 30 } });
  });
});
