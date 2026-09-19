import { TestApiProvider, renderInTestApp } from '@backstage/test-utils';
import type { KubespecResourceListResponse, KubespecSourceSummary } from '@sbordeyne/kubespec-common';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import { type KubespecApi, kubespecApiRef } from '../../api';
import { KubespecSourcesProvider } from '../../hooks';
import { rootRouteRef } from '../../routes';
import { KubespecRouter } from './KubespecRouter';

const SOURCES: KubespecSourceSummary[] = [
  {
    slug: 'kubernetes',
    name: 'Kubernetes',
    kind: 'kubernetes',
    repo: 'kubernetes/kubernetes',
    repoUrl: 'https://github.com/kubernetes/kubernetes',
    versionCount: 1,
    latestVersion: 'v1.34',
  },
  {
    slug: 'cert-manager',
    name: 'cert-manager',
    kind: 'crd',
    repo: 'cert-manager/cert-manager',
    repoUrl: 'https://github.com/cert-manager/cert-manager',
    versionCount: 1,
    latestVersion: 'v1.21.2',
  },
];

const RESOURCES: KubespecResourceListResponse = {
  sourceSlug: 'kubernetes',
  sourceName: 'Kubernetes',
  requestedVersion: 'latest',
  resolvedVersion: 'v1.34',
  isLatest: true,
  categoryOrder: ['Workloads'],
  items: [
    {
      group: 'apps',
      apiVersion: 'v1',
      apiVersionFull: 'apps/v1',
      kind: 'Deployment',
      category: 'Workloads',
      scope: 'Namespaced',
      description: 'Deployment enables declarative updates for Pods.',
      propertyCount: 2,
      hasMetadata: false,
    },
  ],
};

const api = {
  listSources: jest.fn(async () => SOURCES),
  listVersions: jest.fn(async () => ({ items: [] })),
  listResources: jest.fn(async () => RESOURCES),
  getResource: jest.fn(async () => ({
    ...RESOURCES.items[0],
    sourceSlug: 'kubernetes',
    sourceName: 'Kubernetes',
    sourceVersion: 'v1.34',
    isLatest: true,
    definitionBytes: 10,
    definitionHash: 'abc',
    truncated: false,
  })),
  getSchema: jest.fn(async () => ({
    description: '',
    properties: [{ name: 'replicas', type: 'integer', isArray: false, required: false, description: 'How many pods.' }],
  })),
  listChangeSummaries: jest.fn(async () => []),
  listChanges: jest.fn(async () => ({ items: [] })),
  search: jest.fn(async () => ({ resources: [], properties: [] })),
  getMetadata: jest.fn(async () => ({ examples: [], links: [] })),
} as unknown as KubespecApi;

async function renderAt(route: string) {
  await renderInTestApp(
    <TestApiProvider apis={[[kubespecApiRef, api]]}>
      <KubespecSourcesProvider value={{ sources: SOURCES, loading: false }}>
        <Routes>
          <Route path="/kubespec/*" element={<KubespecRouter defaultSourceId="kubernetes" scope="all" />} />
        </Routes>
      </KubespecSourcesProvider>
    </TestApiProvider>,
    {
      routeEntries: [`/kubespec${route}`],
      // The plugin's links are built from its route refs, so the tests have to
      // mount it where the app does rather than at the root.
      mountedRoutes: { '/kubespec': rootRouteRef },
    },
  );
}

describe('KubespecRouter', () => {
  it('renders a source index', async () => {
    await renderAt('/kubernetes/latest');

    expect(await screen.findByText('Kubernetes v1.34')).toBeInTheDocument();
    expect(screen.getByText('Deployment')).toBeInTheDocument();
  });

  it('renders a resource, with the core group spelled out', async () => {
    await renderAt('/kubernetes/latest/apps/v1/Deployment');

    expect(await screen.findByRole('heading', { name: 'Deployment' })).toBeInTheDocument();
    expect(screen.getByRole('tree', { name: 'Properties' })).toBeInTheDocument();
  });

  it('routes a core-group kind through the `core` segment', async () => {
    await renderAt('/kubernetes/v1.33/core/v1/Pod');

    expect(await screen.findByRole('tree', { name: 'Properties' })).toBeInTheDocument();
    expect(api.getResource).toHaveBeenCalledWith(
      expect.objectContaining({ ref: expect.objectContaining({ group: '', kind: 'Pod' }) }),
    );
  });

  it('prefers the search route over a source with the same name', async () => {
    // `search` is a static segment and `:sourceId` a dynamic one, so react-router
    // ranks it first regardless of the order they are declared in.
    await renderAt('/search');

    expect(await screen.findByRole('heading', { name: 'Search' })).toBeInTheDocument();
  });

  it('redirects the bare mount point to the default source at latest', async () => {
    await renderAt('/');

    expect(await screen.findByText('Kubernetes v1.34')).toBeInTheDocument();
  });

  it('sends the source picker to the plugin root, not below the current source', async () => {
    // The reported bug: from /kubespec/kubernetes/latest, picking another source
    // produced /kubespec/kubernetes/kyverno/latest — a relative link resolved
    // against the current URL's depth rather than against the mount point.
    await renderAt('/kubernetes/latest');
    await screen.findByText('Kubernetes v1.34');

    expect(screen.getByRole('link', { name: /cert-manager/ })).toHaveAttribute('href', '/kubespec/cert-manager/latest');
  });

  it('keeps a resource page link inside the plugin', async () => {
    // The same bug seen from one level deeper produced /karpenter/latest, with
    // the plugin's own mount point dropped entirely.
    await renderAt('/kubernetes/latest/apps/v1/Deployment');
    const back = await screen.findByRole('link', { name: /All kinds in/ });

    expect(back).toHaveAttribute('href', '/kubespec/kubernetes/latest');
  });

  it('links a kind to its full five-segment path', async () => {
    await renderAt('/kubernetes/latest');

    const card = await screen.findByRole('link', { name: /Deployment/ });
    expect(card).toHaveAttribute('href', '/kubespec/kubernetes/latest/apps/v1/Deployment');
  });

  it('reports an address that matches nothing', async () => {
    await renderAt('/kubernetes/latest/apps/v1/Deployment/extra/segments');

    expect(await screen.findByText(/does not exist/)).toBeInTheDocument();
  });
});
