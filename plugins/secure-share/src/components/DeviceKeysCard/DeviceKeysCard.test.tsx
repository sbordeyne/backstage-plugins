import { errorApiRef } from '@backstage/core-plugin-api';
import { renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { DeviceKeySummary } from '@sbordeyne/secure-share-common';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SecureShareApi, secureShareApiRef } from '../../api';
import { DeviceKeysCard } from './DeviceKeysCard';

const deviceKey: DeviceKeySummary = {
  id: '11111111-1111-4111-8111-111111111111',
  fingerprint: 'abcdefghijklmnopqrstuvwxyz',
  label: 'Chrome on macOS',
  createdAt: '2026-08-01T10:00:00.000Z',
};

describe('DeviceKeysCard', () => {
  const secureShareApi = {
    enrollDeviceKey: jest.fn(),
    listDeviceKeys: jest.fn(),
    revokeDeviceKey: jest.fn(),
    resolveRecipients: jest.fn(),
  };
  const errorApi = { post: jest.fn(), error$: jest.fn() };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  async function renderCard(): Promise<void> {
    await renderInTestApp(
      <TestApiProvider
        apis={[
          [secureShareApiRef, secureShareApi as unknown as SecureShareApi],
          [errorApiRef, errorApi],
        ]}
      >
        <DeviceKeysCard />
      </TestApiProvider>,
    );
  }

  it('lists an enrolled device with a readable fingerprint', async () => {
    secureShareApi.listDeviceKeys.mockResolvedValue([deviceKey]);

    await renderCard();

    expect(await screen.findByText('Chrome on macOS')).toBeInTheDocument();
    expect(screen.getByText('abcd-efgh-ijkl-mnop')).toBeInTheDocument();
    expect(screen.getByText('never')).toBeInTheDocument();
  });

  it('explains what enrolling does when no key exists yet', async () => {
    secureShareApi.listDeviceKeys.mockResolvedValue([]);

    await renderCard();

    expect(await screen.findByText(/private half never leaves this browser/)).toBeInTheDocument();
  });

  it('revokes a device and reloads the list', async () => {
    secureShareApi.listDeviceKeys.mockResolvedValueOnce([deviceKey]).mockResolvedValueOnce([]);
    secureShareApi.revokeDeviceKey.mockResolvedValue(undefined);

    await renderCard();
    await userEvent.click(await screen.findByLabelText('Revoke Chrome on macOS'));

    await waitFor(() => expect(secureShareApi.revokeDeviceKey).toHaveBeenCalledWith(deviceKey.id));
    expect(await screen.findByText(/private half never leaves this browser/)).toBeInTheDocument();
  });

  it('reports a failed revocation without dropping the list', async () => {
    secureShareApi.listDeviceKeys.mockResolvedValue([deviceKey]);
    secureShareApi.revokeDeviceKey.mockRejectedValue(new Error('nope'));

    await renderCard();
    await userEvent.click(await screen.findByLabelText('Revoke Chrome on macOS'));

    await waitFor(() => expect(errorApi.post).toHaveBeenCalledWith(new Error('nope')));
    expect(screen.getByText('Chrome on macOS')).toBeInTheDocument();
  });

  it('surfaces a failure to load the devices instead of an empty list', async () => {
    secureShareApi.listDeviceKeys.mockRejectedValue(new Error('backend down'));

    await renderCard();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText(/private half never leaves this browser/)).not.toBeInTheDocument();
  });
});
