import { configApiRef, errorApiRef } from '@backstage/core-plugin-api';
import { catalogApiRef } from '@backstage/plugin-catalog-react';
import { mockApis, renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { secureShareApiRef } from '../../api';
import { generateDeviceKeyPair } from '../../crypto';
import { KeyPinStore } from '../../crypto/KeyPinStore';
import { createFakeSecureShareApi, FakeSecureShareApi } from '../../testHelpers/fakeSecureShareApi';
import { CreatePasteForm } from './CreatePasteForm';

const configApi = mockApis.config({
  data: {
    secureShare: {
      expiration: { default: { hours: 1 }, max: { days: 1 }, options: [{ hours: 1 }, { hours: 8 }] },
      limits: { chunkSize: '1KB', maxFileSize: '1MB', maxTextSize: '32B' },
    },
  },
});

describe('CreatePasteForm', () => {
  let secureShareApi: FakeSecureShareApi;
  const catalogApi = { getEntities: jest.fn().mockResolvedValue({ items: [] }) };
  const errorApi = { post: jest.fn(), error$: jest.fn() };

  async function renderForm(): Promise<void> {
    await renderInTestApp(
      <TestApiProvider
        apis={[
          [secureShareApiRef, secureShareApi],
          [configApiRef, configApi],
          [catalogApiRef, catalogApi],
          [errorApiRef, errorApi],
        ]}
      >
        <CreatePasteForm />
      </TestApiProvider>,
    );
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    window.localStorage.clear();
    secureShareApi = createFakeSecureShareApi();
    secureShareApi.enrollFakeDevice({ publicKey: (await generateDeviceKeyPair()).publicKey });
  });

  it('asks for content before anything can be shared', async () => {
    await renderForm();

    expect(await screen.findByText('Enter the content to share')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Encrypt and share' })).toBeDisabled();
  });

  it('offers only the configured expiry options', async () => {
    await renderForm();

    await userEvent.click(screen.getByLabelText('Expires'));

    expect(await screen.findByRole('option', { name: '1 hour' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '8 hours' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '1 day' })).not.toBeInTheDocument();
  });

  it('refuses text larger than the configured limit', async () => {
    await renderForm();

    await userEvent.type(screen.getByLabelText('Content'), 'x'.repeat(40));

    expect(await screen.findByText(/more than the 32B allowed/)).toBeInTheDocument();
  });

  it('insists on a recipient or a secret link', async () => {
    await renderForm();

    await userEvent.type(screen.getByLabelText('Content'), 'hunter2');

    expect(
      await screen.findByText('Pick at least one recipient with an enrolled browser, or ask for a secret link'),
    ).toBeInTheDocument();
  });

  it('warns that a secret link carries the key', async () => {
    await renderForm();

    await userEvent.click(screen.getByLabelText('Also give me a secret link'));

    expect(await screen.findByText(/carries the decryption key/i)).toBeInTheDocument();
  });

  it('shares through a secret link and shows it once', async () => {
    await renderForm();
    await userEvent.type(screen.getByLabelText('Content'), 'hunter2');
    await userEvent.click(screen.getByLabelText('Also give me a secret link'));

    await userEvent.click(await screen.findByRole('button', { name: 'Encrypt and share' }));

    await waitFor(() => expect(secureShareApi.pastes.size).toBe(1));
    expect(await screen.findByText(/shown once and cannot be recovered/)).toBeInTheDocument();
    const [stored] = [...secureShareApi.pastes.values()];
    expect(stored.finalized).toBe(true);
    expect(Buffer.from(stored.chunks[0]).toString()).not.toContain('hunter2');
  });

  it('reports a failure to share without losing the form', async () => {
    secureShareApi.createPaste = jest.fn().mockRejectedValue(new Error('backend down'));
    await renderForm();
    await userEvent.type(screen.getByLabelText('Content'), 'hunter2');
    await userEvent.click(screen.getByLabelText('Also give me a secret link'));

    await userEvent.click(await screen.findByRole('button', { name: 'Encrypt and share' }));

    await waitFor(() => expect(errorApi.post).toHaveBeenCalledWith(new Error('backend down')));
    expect(screen.getByLabelText('Content')).toBeInTheDocument();
  });
});

describe('CreatePasteForm key pinning', () => {
  let secureShareApi: FakeSecureShareApi;
  const catalogApi = {
    getEntities: jest.fn().mockResolvedValue({
      items: [{ apiVersion: 'backstage.io/v1alpha1', kind: 'User', metadata: { name: 'bob', namespace: 'default' } }],
    }),
  };
  const errorApi = { post: jest.fn(), error$: jest.fn() };

  async function renderForm(): Promise<void> {
    await renderInTestApp(
      <TestApiProvider
        apis={[
          [secureShareApiRef, secureShareApi],
          [configApiRef, configApi],
          [catalogApiRef, catalogApi],
          [errorApiRef, errorApi],
        ]}
      >
        <CreatePasteForm />
      </TestApiProvider>,
    );
  }

  async function pickBob(): Promise<void> {
    await userEvent.click(screen.getByLabelText('Recipients'));
    await userEvent.click(await screen.findByText('user:bob'));
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    window.localStorage.clear();
    secureShareApi = createFakeSecureShareApi();
    secureShareApi.enrollFakeDevice({ publicKey: (await generateDeviceKeyPair()).publicKey });
  });

  it('shares with a recipient seen for the first time without asking anything', async () => {
    await renderForm();
    await userEvent.type(screen.getByLabelText('Content'), 'hunter2');
    await pickBob();

    await waitFor(() => expect(screen.getByRole('button', { name: 'Encrypt and share' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Encrypt and share' }));

    await waitFor(() => expect(secureShareApi.pastes.size).toBe(1));
  });

  it('pins the keys it shared with, so the next send is silent', async () => {
    await renderForm();
    await userEvent.type(screen.getByLabelText('Content'), 'hunter2');
    await pickBob();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Encrypt and share' })).toBeEnabled());

    await userEvent.click(screen.getByRole('button', { name: 'Encrypt and share' }));

    await waitFor(() => expect(secureShareApi.pastes.size).toBe(1));
    const pinned = KeyPinStore.create(window.localStorage).getPinned('user:default/bob');
    expect(pinned).toEqual([secureShareApi.enrolledKeys[0].fingerprint]);
  });

  it('does not pin anything when the form is abandoned', async () => {
    await renderForm();
    await pickBob();

    await waitFor(() => expect(screen.getByText(/1 device/)).toBeInTheDocument());
    expect(KeyPinStore.create(window.localStorage).getPinned('user:default/bob')).toEqual([]);
  });

  it('blocks sharing until an unrecognised device fingerprint is confirmed', async () => {
    KeyPinStore.create(window.localStorage).trust({
      userEntityRef: 'user:default/bob',
      fingerprints: ['a-key-from-a-previous-share'],
    });
    await renderForm();
    await userEvent.type(screen.getByLabelText('Content'), 'hunter2');
    await pickBob();

    expect(await screen.findByText(/has a device this browser has not seen before/)).toBeInTheDocument();
    expect(
      await screen.findByText('Confirm the unrecognised device fingerprints above before sharing'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Encrypt and share' })).toBeDisabled();
  });

  it('allows sharing once the sender says the fingerprint checks out', async () => {
    KeyPinStore.create(window.localStorage).trust({
      userEntityRef: 'user:default/bob',
      fingerprints: ['a-key-from-a-previous-share'],
    });
    await renderForm();
    await userEvent.type(screen.getByLabelText('Content'), 'hunter2');
    await pickBob();

    await userEvent.click(await screen.findByRole('button', { name: 'Fingerprint checked' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Encrypt and share' })).toBeEnabled());
    await userEvent.click(screen.getByRole('button', { name: 'Encrypt and share' }));
    await waitFor(() => expect(secureShareApi.pastes.size).toBe(1));
  });
});
