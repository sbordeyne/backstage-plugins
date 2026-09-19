import { renderInTestApp } from '@backstage/test-utils';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router-dom';

import type { ResourceRef } from '../lib/paths';
import { rootRouteRef } from '../routes';
import { useGvkNavigation } from './useGvkNavigation';

function Harness(props: { sourceId: string; sourceVersion: string; resource?: ResourceRef }) {
  const navigation = useGvkNavigation(props);
  const location = useLocation();

  return (
    <div>
      <button type="button" onClick={() => navigation.switchSource('karpenter')}>
        switch source
      </button>
      <button type="button" onClick={() => navigation.switchVersion('v1.31')}>
        switch version
      </button>
      <button type="button" onClick={() => navigation.pinVersion('v1.34')}>
        pin
      </button>
      <span data-testid="location">{location.pathname}</span>
    </div>
  );
}

const DEPLOYMENT: ResourceRef = {
  sourceId: 'kubernetes',
  sourceVersion: 'latest',
  group: 'apps',
  apiVersion: 'v1',
  kind: 'Deployment',
};

async function render(route: string, props: { sourceId: string; sourceVersion: string; resource?: ResourceRef }) {
  await renderInTestApp(
    <Routes>
      <Route path="/kubespec/*" element={<Harness {...props} />} />
      <Route path="*" element={<span data-testid="location">escaped the plugin</span>} />
    </Routes>,
    { routeEntries: [route], mountedRoutes: { '/kubespec': rootRouteRef } },
  );
}

describe('useGvkNavigation', () => {
  it('sends a source switch to the plugin root from an index page', async () => {
    // Reported bug: this produced /kubespec/kubernetes/karpenter/latest, because
    // a relative link resolves against the current URL rather than the mount point.
    await render('/kubespec/kubernetes/latest', { sourceId: 'kubernetes', sourceVersion: 'latest' });

    await userEvent.click(screen.getByRole('button', { name: 'switch source' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/kubespec/karpenter/latest');
  });

  it('sends a source switch to the plugin root from a resource page too', async () => {
    // From one level deeper the same bug produced /karpenter/latest, dropping the
    // plugin's mount point entirely.
    await render('/kubespec/kubernetes/latest/apps/v1/Deployment', {
      sourceId: 'kubernetes',
      sourceVersion: 'latest',
      resource: DEPLOYMENT,
    });

    await userEvent.click(screen.getByRole('button', { name: 'switch source' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/kubespec/karpenter/latest');
  });

  it('keeps the kind when only the version changes', async () => {
    await render('/kubespec/kubernetes/latest/apps/v1/Deployment', {
      sourceId: 'kubernetes',
      sourceVersion: 'latest',
      resource: DEPLOYMENT,
    });

    await userEvent.click(screen.getByRole('button', { name: 'switch version' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/kubespec/kubernetes/v1.31/apps/v1/Deployment');
  });

  it('changes only the version on an index page, where there is no kind to carry', async () => {
    await render('/kubespec/kubernetes/latest', { sourceId: 'kubernetes', sourceVersion: 'latest' });

    await userEvent.click(screen.getByRole('button', { name: 'switch version' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/kubespec/kubernetes/v1.31');
  });

  it('pins the alias to the concrete version it resolved to', async () => {
    await render('/kubespec/kubernetes/latest/apps/v1/Deployment', {
      sourceId: 'kubernetes',
      sourceVersion: 'latest',
      resource: DEPLOYMENT,
    });

    await userEvent.click(screen.getByRole('button', { name: 'pin' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/kubespec/kubernetes/v1.34/apps/v1/Deployment');
  });

  it('spells the core group as `core` when it navigates', async () => {
    await render('/kubespec/kubernetes/latest/core/v1/Pod', {
      sourceId: 'kubernetes',
      sourceVersion: 'latest',
      resource: { sourceId: 'kubernetes', sourceVersion: 'latest', group: '', apiVersion: 'v1', kind: 'Pod' },
    });

    await userEvent.click(screen.getByRole('button', { name: 'switch version' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/kubespec/kubernetes/v1.31/core/v1/Pod');
  });
});
