import { TestApiProvider, renderInTestApp } from '@backstage/test-utils';
import type { KubespecResourceListResponse, KubespecSourceSummary } from '@sbordeyne/kubespec-common';
import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import { type KubespecApi, kubespecApiRef } from '../../api';
import { KubespecSourcesProvider } from '../../hooks';
import { rootRouteRef } from '../../routes';
import { SourceIndexPage } from './SourceIndexPage';

const SOURCES: KubespecSourceSummary[] = [
  {
    slug: 'kubernetes',
    name: 'Kubernetes',
    kind: 'kubernetes',
    repo: 'kubernetes/kubernetes',
    repoUrl: 'https://github.com/kubernetes/kubernetes',
    versionCount: 1,
    latestVersion: 'v1.34',
    logoUrl: 'https://example.invalid/kubernetes.png',
  },
  {
    slug: 'karpenter',
    name: 'Karpenter',
    kind: 'crd',
    repo: 'aws/karpenter-provider-aws',
    repoUrl: 'https://github.com/aws/karpenter-provider-aws',
    versionCount: 1,
    latestVersion: 'v1.14.1',
    logoUrl: 'https://example.invalid/karpenter.png',
  },
  {
    slug: 'kyverno',
    name: 'Kyverno',
    kind: 'crd',
    repo: 'kyverno/kyverno',
    repoUrl: 'https://github.com/kyverno/kyverno',
    versionCount: 1,
    latestVersion: 'v1.19.1',
  },
];

const RESOURCES: KubespecResourceListResponse = {
  sourceSlug: 'kubernetes',
  sourceName: 'Kubernetes',
  requestedVersion: 'latest',
  resolvedVersion: 'v1.34',
  isLatest: true,
  categoryOrder: ['Workloads', 'Cluster'],
  items: [
    {
      group: 'apps',
      apiVersion: 'v1',
      apiVersionFull: 'apps/v1',
      kind: 'StatefulSet',
      category: 'Workloads',
      scope: 'Namespaced',
      description: '',
      propertyCount: 1,
      hasMetadata: false,
    },
    {
      group: 'apps',
      apiVersion: 'v1',
      apiVersionFull: 'apps/v1',
      kind: 'Deployment',
      category: 'Workloads',
      scope: 'Namespaced',
      description: '',
      propertyCount: 1,
      hasMetadata: false,
    },
    {
      group: '',
      apiVersion: 'v1',
      apiVersionFull: 'v1',
      kind: 'Node',
      category: 'Cluster',
      scope: 'Cluster',
      description: '',
      propertyCount: 1,
      hasMetadata: false,
    },
  ],
};

const api = {
  listResources: jest.fn(async () => RESOURCES),
} as unknown as KubespecApi;

async function render() {
  await renderInTestApp(
    <TestApiProvider apis={[[kubespecApiRef, api]]}>
      <KubespecSourcesProvider value={{ sources: SOURCES, loading: false }}>
        <Routes>
          <Route path="/kubespec/:sourceId/:sourceVersion" element={<SourceIndexPage scope="all" />} />
        </Routes>
      </KubespecSourcesProvider>
    </TestApiProvider>,
    {
      routeEntries: ['/kubespec/kubernetes/latest'],
      mountedRoutes: { '/kubespec': rootRouteRef },
    },
  );
  await screen.findByText('Kubernetes v1.34');
}

describe('SourceIndexPage', () => {
  it('lays each category out as a list rather than a single row', async () => {
    await render();

    // BUI's Flex cannot wrap, which is what put every kind of a category on one
    // clipped line; the grid is a real list the browser can wrap.
    const lists = screen.getAllByRole('list');
    expect(lists.length).toBeGreaterThanOrEqual(2);
    expect(within(lists[0]).getAllByRole('listitem')).toHaveLength(2);
  });

  it('orders categories as the backend asked and kinds alphabetically', async () => {
    await render();

    const headings = screen.getAllByRole('heading', { level: 3 }).map(heading => heading.textContent);
    expect(headings).toEqual(['Workloads (2)', 'Cluster (1)', 'Other sources']);

    const [workloads] = screen.getAllByRole('list');
    expect(
      within(workloads)
        .getAllByRole('link')
        .map(link => link.textContent),
    ).toEqual(['apps/v1Deployment', 'apps/v1StatefulSet']);
  });

  it('badges a cluster-scoped kind and leaves namespaced ones unlabelled', async () => {
    await render();

    // Namespaced is the overwhelming default, so only the exception is called out.
    expect(screen.getByLabelText('Cluster-scoped resource')).toBeInTheDocument();
    expect(screen.queryByLabelText('Namespaced resource')).not.toBeInTheDocument();
  });

  it('shows the other sources with their logos', async () => {
    await render();

    // The logo is decorative (alt=""), so it is queried by tag rather than by
    // role — announcing the source name twice would help nobody.
    const karpenter = screen.getByRole('link', { name: /Karpenter/ });
    expect(karpenter.querySelector('img')).toHaveAttribute('src', 'https://example.invalid/karpenter.png');

    // A source configured without a logo still lines up, rather than leaving a
    // ragged gap where the image would be.
    expect(screen.getByRole('link', { name: /Kyverno/ })).toBeInTheDocument();
  });

  it('excludes the current source from the other-sources grid', async () => {
    await render();

    const links = screen.getAllByRole('link').map(link => link.getAttribute('href'));
    expect(links).toContain('/kubespec/karpenter/latest');
    expect(links).not.toContain('/kubespec/kubernetes/latest');
  });
});
