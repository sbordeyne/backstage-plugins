import { renderTestApp } from '@backstage/frontend-test-utils';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { screen } from '@testing-library/react';
import { secureShareApiRef } from './api';
import secureSharePlugin from './alpha';
import { createFakeSecureShareApi } from './testHelpers/fakeSecureShareApi';

/**
 * The plugin as an app sees it: what the sidebar gets, and which of the three pages each path
 * lands on. The router lives behind a single page extension, so the sub routes are only reachable
 * if the app mounts that page with a wildcard — which is the part worth asserting.
 */
describe('secureSharePlugin', () => {
  function renderApp(path: string): void {
    renderTestApp({
      features: [secureSharePlugin],
      initialRouteEntries: [path],
      apis: [
        [secureShareApiRef, createFakeSecureShareApi()],
        // The recipient picker asks for every user and group up front; an empty catalog is enough
        // to render the form.
        [catalogApiRef, { getEntities: async () => ({ items: [] }) }],
      ],
    });
  }

  it('puts the page in the sidebar', async () => {
    renderApp('/secure-share');

    expect(await screen.findByRole('link', { name: 'Secure Share' })).toHaveAttribute('href', '/secure-share');
  });

  it('shares from the root path', async () => {
    renderApp('/secure-share');

    expect(await screen.findByRole('heading', { name: 'Secure share' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Recipients')).toBeInTheDocument();
  });

  it('opens a paste shared with this browser', async () => {
    renderApp('/secure-share/paste/some-paste');

    expect(await screen.findByRole('heading', { name: 'Shared secret' })).toBeInTheDocument();
  });

  it('opens a secret link, and says so when the key is missing from the fragment', async () => {
    renderApp('/secure-share/link/some-paste');

    expect(await screen.findByText('Opened from a secret link')).toBeInTheDocument();
    expect(await screen.findByText(/This link is missing its key/)).toBeInTheDocument();
  });
});
