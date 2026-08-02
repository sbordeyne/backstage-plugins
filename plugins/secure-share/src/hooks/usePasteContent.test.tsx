import { configApiRef } from '@backstage/core-plugin-api';
import { mockApis, TestApiProvider } from '@backstage/test-utils';
import { act, renderHook, waitFor } from '@testing-library/react';
import { PropsWithChildren } from 'react';
import { secureShareApiRef } from '../api';
import { DeviceKeyPair, generateDeviceKeyPair } from '../crypto';
import { createFakeSecureShareApi, FakeSecureShareApi } from '../testHelpers/fakeSecureShareApi';
import { CreatePasteInput, useCreatePaste } from './useCreatePaste';
import { PasteAccess, usePasteContent } from './usePasteContent';

const configApi = mockApis.config({
  data: { secureShare: { limits: { chunkSize: '1KB', maxFileSize: '1MB', maxTextSize: '64KB' } } },
});

describe('usePasteContent', () => {
  let secureShareApi: FakeSecureShareApi;

  function wrapper({ children }: PropsWithChildren<{}>): JSX.Element {
    return (
      <TestApiProvider
        apis={[
          [secureShareApiRef, secureShareApi],
          [configApiRef, configApi],
        ]}
      >
        {children}
      </TestApiProvider>
    );
  }

  /** Shares a paste the way the create form does, and returns how to open it. */
  async function share(
    overrides: Partial<CreatePasteInput> = {},
  ): Promise<{ pasteId: string; linkUrl?: string; recipient: DeviceKeyPair; deviceKeyId: string }> {
    const recipient = await generateDeviceKeyPair();
    const deviceKey = secureShareApi.enrollFakeDevice({ publicKey: recipient.publicKey });
    const { result } = renderHook(() => useCreatePaste(), { wrapper });

    const created = await act(
      async () =>
        await result.current.create({
          kind: 'text',
          payload: new Blob(['the password is hunter2']),
          title: 'Staging credentials',
          mimeType: 'text/plain',
          language: 'plaintext',
          recipients: [{ userEntityRef: 'user:default/bob', viaEntityRefs: ['user:default/bob'], keys: [deviceKey] }],
          recipientEntityRefs: ['user:default/bob'],
          expiresAt: new Date('2026-08-02T10:00:00.000Z'),
          burnAfterRead: false,
          linkEnabled: false,
          ...overrides,
        }),
    );

    return { ...created, recipient, deviceKeyId: deviceKey.id };
  }

  function recipientAccess(shared: { recipient: DeviceKeyPair; deviceKeyId: string }): PasteAccess {
    return { via: 'recipient', deviceKeyId: shared.deviceKeyId, privateKey: shared.recipient.privateKey };
  }

  beforeEach(() => {
    secureShareApi = createFakeSecureShareApi();
  });

  it('decrypts a paste for the device it was wrapped for', async () => {
    const shared = await share();

    const { result } = renderHook(() => usePasteContent({ pasteId: shared.pasteId, access: recipientAccess(shared) }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.value).toBeDefined());
    expect(result.current.value?.metadata.title).toBe('Staging credentials');
    expect(await result.current.value?.payload.text()).toBe('the password is hunter2');
  });

  it('decrypts a payload that spans several chunks', async () => {
    const bytes = new Uint8Array(Array.from({ length: 2500 }, (_, index) => index % 256));
    const shared = await share({ payload: new Blob([bytes]) });

    const { result } = renderHook(() => usePasteContent({ pasteId: shared.pasteId, access: recipientAccess(shared) }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.value).toBeDefined());
    expect(new Uint8Array(await result.current.value!.payload.arrayBuffer())).toEqual(bytes);
  });

  it('decrypts a paste opened from a secret link', async () => {
    const shared = await share({ linkEnabled: true });
    const fragment = new URLSearchParams(new URL(shared.linkUrl as string).hash.slice(1));

    const { result } = renderHook(
      () =>
        usePasteContent({
          pasteId: shared.pasteId,
          access: { via: 'link', linkToken: fragment.get('t') as string, dataKey: fragment.get('k') as string },
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.value).toBeDefined());
    expect(await result.current.value?.payload.text()).toBe('the password is hunter2');
  });

  it('fails on a link whose token is wrong', async () => {
    const shared = await share({ linkEnabled: true });
    const fragment = new URLSearchParams(new URL(shared.linkUrl as string).hash.slice(1));

    const { result } = renderHook(
      () =>
        usePasteContent({
          pasteId: shared.pasteId,
          access: { via: 'link', linkToken: 'guessed', dataKey: fragment.get('k') as string },
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.error?.message).toMatch(/no longer available/);
  });

  it('fails on a link whose key is wrong', async () => {
    const shared = await share({ linkEnabled: true });
    const otherPaste = await share({ linkEnabled: true });
    const otherKey = new URLSearchParams(new URL(otherPaste.linkUrl as string).hash.slice(1)).get('k') as string;

    const { result } = renderHook(
      () =>
        usePasteContent({
          pasteId: shared.pasteId,
          access: { via: 'link', linkToken: secureShareApi.linkToken, dataKey: otherKey },
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.error).toBeDefined());
  });

  it('refuses to decrypt for a device the paste was not wrapped for', async () => {
    const shared = await share();
    const stranger = await generateDeviceKeyPair();
    const strangerKey = secureShareApi.enrollFakeDevice({ publicKey: stranger.publicKey });

    const { result } = renderHook(
      () =>
        usePasteContent({
          pasteId: shared.pasteId,
          access: { via: 'recipient', deviceKeyId: strangerKey.id, privateKey: stranger.privateKey },
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.error?.message).toMatch(/carries no key for this device/);
  });

  it('rejects a payload the backend truncated', async () => {
    const shared = await share({ payload: new Blob([new Uint8Array(2500)]) });
    const stored = secureShareApi.pastes.get(shared.pasteId)!;
    stored.chunks = stored.chunks.slice(0, 2);
    stored.summary = { ...stored.summary, chunkCount: 2 };

    const { result } = renderHook(() => usePasteContent({ pasteId: shared.pasteId, access: recipientAccess(shared) }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.error).toBeDefined());
    expect(result.current.error?.message).toMatch(/altered in transit/);
  });

  it('rejects a chunk the backend swapped', async () => {
    const shared = await share({ payload: new Blob([new Uint8Array(2500)]) });
    const stored = secureShareApi.pastes.get(shared.pasteId)!;
    stored.chunks = [stored.chunks[1], stored.chunks[0], stored.chunks[2]];

    const { result } = renderHook(() => usePasteContent({ pasteId: shared.pasteId, access: recipientAccess(shared) }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.error).toBeDefined());
  });

  it('rejects metadata the backend replaced', async () => {
    const shared = await share();
    const stored = secureShareApi.pastes.get(shared.pasteId)!;
    stored.summary = { ...stored.summary, metaCiphertext: Buffer.from('forged metadata').toString('base64') };

    const { result } = renderHook(() => usePasteContent({ pasteId: shared.pasteId, access: recipientAccess(shared) }), {
      wrapper,
    });

    await waitFor(() => expect(result.current.error).toBeDefined());
  });

  it('waits without failing until an access is known', async () => {
    const shared = await share();

    const { result } = renderHook(() => usePasteContent({ pasteId: shared.pasteId, access: undefined }), { wrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.value).toBeUndefined();
    expect(result.current.error).toBeUndefined();
  });
});
