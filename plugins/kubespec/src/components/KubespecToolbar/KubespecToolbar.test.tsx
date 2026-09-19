import { TestApiProvider, renderInTestApp } from '@backstage/test-utils';
import type { KubespecSourceSummary } from '@sbordeyne/kubespec-common';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { type KubespecApi, kubespecApiRef } from '../../api';
import { KubespecSourcesProvider } from '../../hooks';
import { rootRouteRef } from '../../routes';
import { KubespecToolbar } from './KubespecToolbar';

const SOURCES: KubespecSourceSummary[] = [
  {
    slug: 'kubernetes',
    name: 'Kubernetes',
    kind: 'kubernetes',
    repo: 'kubernetes/kubernetes',
    repoUrl: 'https://github.com/kubernetes/kubernetes',
    versionCount: 4,
    latestVersion: 'v1.37',
  },
  {
    slug: 'keda',
    name: 'KEDA',
    kind: 'crd',
    repo: 'kedacore/keda',
    repoUrl: 'https://github.com/kedacore/keda',
    versionCount: 10,
    latestVersion: 'v2.20.2',
  },
];

function createApi(triggerSync: jest.Mock): KubespecApi {
  return {
    listVersions: jest.fn(async () => ({ items: [] })),
    triggerSync,
  } as unknown as KubespecApi;
}

async function render(api: KubespecApi, route = '/kubespec/kubernetes/latest') {
  await renderInTestApp(
    <TestApiProvider apis={[[kubespecApiRef, api]]}>
      <KubespecSourcesProvider value={{ sources: SOURCES, loading: false }}>
        <Routes>
          {/* Beside the router under the plugin's own splat route, exactly as the
              page mounts it. Rendering it inside `:sourceId/:sourceVersion`
              instead would hand it route params the real app never gives it, and
              hide the very bug this guards. */}
          <Route
            path="/kubespec/*"
            element={<KubespecToolbar defaultSourceId="kubernetes" scope="all" onScopeChange={jest.fn()} />}
          />
        </Routes>
      </KubespecSourcesProvider>
    </TestApiProvider>,
    {
      routeEntries: [route],
      mountedRoutes: { '/kubespec': rootRouteRef },
    },
  );
}

describe('KubespecToolbar', () => {
  it('queues a sync and says so', async () => {
    const triggerSync = jest.fn(async () => ({ triggered: true }));
    await render(createApi(triggerSync));

    await userEvent.click(await screen.findByRole('button', { name: 'Force a full resync' }));

    expect(triggerSync).toHaveBeenCalled();
    // The request only queues the task, so the message must not imply the data
    // is already there.
    expect(await screen.findByRole('status')).toHaveTextContent('Full resync queued');
  });

  it('says a sync is already running instead of reporting a conflict', async () => {
    // The backend answers 202 with alreadyRunning when the scheduler declines a
    // trigger because the task is mid-run; the reader asked for a sync and one is
    // happening, so this is not a failure.
    const triggerSync = jest.fn(async () => ({ triggered: false, alreadyRunning: true }));
    await render(createApi(triggerSync));

    await userEvent.click(await screen.findByRole('button', { name: 'Force a full resync' }));

    expect(await screen.findByRole('status')).toHaveTextContent('already running');
  });

  it('surfaces the backend message when sync is turned off', async () => {
    // The likeliest failure in practice: `kubespec.sync.enabled` is false, and
    // the backend answers 404 with the config key to change.
    const triggerSync = jest.fn(async () => {
      throw new Error('Kubespec sync is disabled; set kubespec.sync.enabled to true to schedule it');
    });
    await render(createApi(triggerSync));

    await userEvent.click(await screen.findByRole('button', { name: 'Force a full resync' }));

    expect(await screen.findByRole('status')).toHaveTextContent('kubespec.sync.enabled');
  });

  it('scopes the version list to whichever source is open', async () => {
    // Reported bug: on the KEDA page the picker listed Kubernetes releases,
    // because the toolbar renders beside the router and `useParams` there
    // reported no source, so it fell back to the default.
    const listVersions = jest.fn(async () => ({ items: [{ version: 'v2.20.2' }] }));
    await render({ ...createApi(jest.fn()), listVersions } as unknown as KubespecApi, '/kubespec/keda/v2.20.1');

    await screen.findByRole('button', { name: 'Force a full resync' });
    expect(listVersions).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'keda' }));
    expect(listVersions).not.toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'kubernetes' }));
  });

  it('shows the version the URL is on, not always `latest`', async () => {
    // The same fallback left the picker reading `latest` after every switch,
    // while the page below it showed the version that had been picked.
    await render(createApi(jest.fn()), '/kubespec/keda/v2.20.1');

    // The trigger announces its selected value, so finding it by that name is
    // the assertion: a version missing from the loaded list would leave the
    // placeholder, "Select an option", in its place.
    expect(await screen.findByRole('button', { name: /v2\.20\.1/ })).toBeInTheDocument();
    expect(screen.queryByText('Select an option')).not.toBeInTheDocument();
  });

  it('asks for a forced resync, not an ordinary one', async () => {
    // The button's job is to rebuild, including sources that have never been
    // ingested — an ordinary tick would skip everything whose content is
    // unchanged and never reach them.
    const triggerSync = jest.fn(async () => ({ triggered: true }));
    await render(createApi(triggerSync));

    await userEvent.click(await screen.findByRole('button', { name: 'Force a full resync' }));

    expect(triggerSync).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
  });

  it('offers the scope toggle when the route has something to filter', async () => {
    await render(createApi(jest.fn()));

    expect(await screen.findByRole('radio', { name: 'Cluster' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Namespaced' })).toBeInTheDocument();
    // The source picker is gone: sources are chosen from the grid on the index page.
    expect(screen.queryByRole('button', { name: /Kubernetes/ })).not.toBeInTheDocument();
  });
});
