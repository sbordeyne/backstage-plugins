import { TestApiProvider } from '@backstage/test-utils';
import { act, renderHook, waitFor } from '@testing-library/react';
import { PropsWithChildren } from 'react';
import { SecureShareApi, secureShareApiRef } from '../api';
import { computeFingerprint, DeviceKeyStorage, generateDeviceKeyPair } from '../crypto';
import { useDeviceKey } from './useDeviceKey';

describe('useDeviceKey', () => {
  const secureShareApi = {
    enrollDeviceKey: jest.fn(),
    listDeviceKeys: jest.fn(),
    revokeDeviceKey: jest.fn(),
    resolveRecipients: jest.fn(),
    createPaste: jest.fn(),
    uploadChunk: jest.fn(),
    finalizePaste: jest.fn(),
    listSharedWithMe: jest.fn(),
    listMyPastes: jest.fn(),
    readPaste: jest.fn(),
    fetchChunk: jest.fn(),
    readLinkedPaste: jest.fn(),
    fetchLinkedChunk: jest.fn(),
    listPasteReads: jest.fn(),
    deletePaste: jest.fn(),
  };
  const storage = DeviceKeyStorage.create();

  function wrapper({ children }: PropsWithChildren<{}>): JSX.Element {
    return (
      <TestApiProvider apis={[[secureShareApiRef, secureShareApi as unknown as SecureShareApi]]}>
        {children}
      </TestApiProvider>
    );
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    await storage.clear();
  });

  it('reports no device key in a fresh browser', async () => {
    const { result } = renderHook(() => useDeviceKey(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.deviceKey).toBeUndefined();
  });

  it('enrolls a key and keeps it for the next visit', async () => {
    secureShareApi.enrollDeviceKey.mockImplementation(async ({ publicKey }) => ({
      id: 'device-1',
      fingerprint: await computeFingerprint(publicKey),
      label: 'Chrome on macOS',
      createdAt: '2026-08-01T10:00:00.000Z',
    }));
    const { result } = renderHook(() => useDeviceKey(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.enroll('Chrome on macOS');
    });

    expect(result.current.deviceKey?.deviceKeyId).toBe('device-1');
    expect((await storage.load())?.deviceKeyId).toBe('device-1');
    expect(secureShareApi.enrollDeviceKey).toHaveBeenCalledWith({
      publicKey: expect.objectContaining({ kty: 'EC', crv: 'P-256' }),
      label: 'Chrome on macOS',
    });
  });

  it('publishes only the public half of the key pair', async () => {
    secureShareApi.enrollDeviceKey.mockImplementation(async ({ publicKey }) => ({
      id: 'device-1',
      fingerprint: await computeFingerprint(publicKey),
      label: 'Chrome',
      createdAt: 'now',
    }));
    const { result } = renderHook(() => useDeviceKey(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.enroll();
    });

    const [{ publicKey }] = secureShareApi.enrollDeviceKey.mock.calls[0];
    expect(Object.keys(publicKey).sort()).toEqual(['crv', 'kty', 'x', 'y']);
  });

  it('refuses an enrollment whose fingerprint the backend changed', async () => {
    secureShareApi.enrollDeviceKey.mockResolvedValue({
      id: 'device-1',
      fingerprint: 'a-fingerprint-of-another-key',
      label: 'Chrome',
      createdAt: 'now',
    });
    const { result } = renderHook(() => useDeviceKey(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.enroll();
    });

    expect(result.current.deviceKey).toBeUndefined();
    expect(result.current.error?.message).toMatch(/different fingerprint/);
    expect(await storage.load()).toBeUndefined();
  });

  it('surfaces a failed enrollment without storing anything', async () => {
    secureShareApi.enrollDeviceKey.mockRejectedValue(new Error('backend down'));
    const { result } = renderHook(() => useDeviceKey(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.enroll();
    });

    expect(result.current.error?.message).toBe('backend down');
    expect(await storage.load()).toBeUndefined();
  });

  it('loads a key that a previous visit enrolled', async () => {
    const keyPair = await generateDeviceKeyPair();
    await storage.save({ ...keyPair, fingerprint: 'abc', deviceKeyId: 'device-1' });

    const { result } = renderHook(() => useDeviceKey(), { wrapper });

    await waitFor(() => expect(result.current.deviceKey?.deviceKeyId).toBe('device-1'));
    expect(secureShareApi.enrollDeviceKey).not.toHaveBeenCalled();
  });

  it('ignores a key pair that was never enrolled', async () => {
    await storage.save({ ...(await generateDeviceKeyPair()), fingerprint: 'abc' });

    const { result } = renderHook(() => useDeviceKey(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.deviceKey).toBeUndefined();
  });

  it('forgets the key on request, which makes earlier pastes unreadable here', async () => {
    const keyPair = await generateDeviceKeyPair();
    await storage.save({ ...keyPair, fingerprint: 'abc', deviceKeyId: 'device-1' });
    const { result } = renderHook(() => useDeviceKey(), { wrapper });
    await waitFor(() => expect(result.current.deviceKey).toBeDefined());

    await act(async () => {
      await result.current.forget();
    });

    expect(result.current.deviceKey).toBeUndefined();
    expect(await storage.load()).toBeUndefined();
  });

  it('suggests a label based on the browser', async () => {
    const { result } = renderHook(() => useDeviceKey(), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.suggestedLabel).toEqual(expect.any(String));
  });
});
