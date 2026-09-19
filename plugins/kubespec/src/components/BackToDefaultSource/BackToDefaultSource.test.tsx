import { TestApiProvider, renderInTestApp } from '@backstage/test-utils';
import type { KubespecSourceSummary } from '@sbordeyne/kubespec-common';
import { screen } from '@testing-library/react';

import { kubespecApiRef } from '../../api';
import { KubespecSourcesProvider } from '../../hooks';
import { rootRouteRef } from '../../routes';
import { BackToDefaultSource } from './BackToDefaultSource';

const KUBERNETES: KubespecSourceSummary = {
  slug: 'kubernetes',
  name: 'Kubernetes',
  kind: 'kubernetes',
  repo: 'kubernetes/kubernetes',
  repoUrl: 'https://github.com/kubernetes/kubernetes',
  versionCount: 4,
  latestVersion: 'v1.37',
};

async function render(sourceId: string, sources: KubespecSourceSummary[] = [KUBERNETES]) {
  await renderInTestApp(
    <TestApiProvider apis={[[kubespecApiRef, {} as never]]}>
      <KubespecSourcesProvider value={{ sources, loading: false }}>
        <BackToDefaultSource sourceId={sourceId} />
      </KubespecSourcesProvider>
    </TestApiProvider>,
    { mountedRoutes: { '/kubespec': rootRouteRef } },
  );
}

describe('BackToDefaultSource', () => {
  it('links back to the core API from a CRD source', async () => {
    await render('keda');

    expect(screen.getByRole('link', { name: '← Back to Kubernetes' })).toHaveAttribute(
      'href',
      '/kubespec/kubernetes/latest',
    );
  });

  it('renders nothing when the core API is already open', async () => {
    await render('kubernetes');

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders nothing when the core API has never been ingested', async () => {
    // Otherwise the one link out of a CRD source leads to a 404.
    await render('keda', [{ ...KUBERNETES, latestVersion: undefined, versionCount: 0 }]);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
