import { configApiRef } from '@backstage/core-plugin-api';
import { mockApis, TestApiProvider } from '@backstage/test-utils';
import { act, renderHook } from '@testing-library/react';
import { PropsWithChildren } from 'react';
import { secureShareApiRef } from '../api';
import { generateDeviceKeyPair, openMetadata, unwrapDataKey } from '../crypto';
import { importDataKeyFromLink } from '../crypto/envelope';
import { createFakeSecureShareApi, FakeSecureShareApi } from '../testHelpers/fakeSecureShareApi';
import { CreatePasteInput, useCreatePaste } from './useCreatePaste';

const configApi = mockApis.config({
  data: { secureShare: { limits: { chunkSize: '1KB', maxFileSize: '1MB', maxTextSize: '64KB' } } },
});

describe('useCreatePaste', () => {
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

  async function inputFor(overrides: Partial<CreatePasteInput> = {}): Promise<CreatePasteInput> {
    const recipientKeyPair = await generateDeviceKeyPair();
    const deviceKey = secureShareApi.enrollFakeDevice({ publicKey: recipientKeyPair.publicKey });
    return {
      kind: 'text',
      payload: new Blob(['the password is hunter2']),
      title: 'Staging credentials',
      mimeType: 'text/plain',
      language: 'plaintext',
      recipients: [{ userEntityRef: 'user:default/bob', viaEntityRefs: ['user:default/bob'], keys: [deviceKey] }],
      recipientEntityRefs: ['user:default/bob'],
      expiresAt: new Date('2026-08-02T10:00:00.000Z'),
      burnAfterRead: true,
      linkEnabled: false,
      ...overrides,
    };
  }

  beforeEach(() => {
    secureShareApi = createFakeSecureShareApi();
  });

  it('uploads ciphertext only, and never the title', async () => {
    const input = await inputFor();
    const { result } = renderHook(() => useCreatePaste(), { wrapper });

    const created = await act(async () => await result.current.create(input));

    const stored = secureShareApi.pastes.get(created.pasteId);
    expect(stored?.finalized).toBe(true);
    expect(stored?.summary.metaCiphertext).not.toContain('Staging');
    expect(Buffer.concat(stored?.chunks.map(chunk => Buffer.from(chunk)) ?? []).toString()).not.toContain('hunter2');
  });

  it('declares the exact chunk count and ciphertext size it then uploads', async () => {
    const input = await inputFor({ payload: new Blob([new Uint8Array(2500)]) });
    const { result } = renderHook(() => useCreatePaste(), { wrapper });

    const created = await act(async () => await result.current.create(input));

    const stored = secureShareApi.pastes.get(created.pasteId);
    expect(stored?.summary.chunkCount).toBe(3);
    expect(stored?.chunks).toHaveLength(3);
    expect(stored?.chunks.reduce((total, chunk) => total + chunk.length, 0)).toBe(stored?.summary.sizeBytes);
  });

  it('wraps the data key once per recipient device', async () => {
    const first = await generateDeviceKeyPair();
    const second = await generateDeviceKeyPair();
    const keys = [
      secureShareApi.enrollFakeDevice({ publicKey: first.publicKey }),
      secureShareApi.enrollFakeDevice({ publicKey: second.publicKey }),
    ];
    const input = await inputFor({
      recipients: [{ userEntityRef: 'user:default/bob', viaEntityRefs: ['group:default/team'], keys }],
    });
    const { result } = renderHook(() => useCreatePaste(), { wrapper });

    const created = await act(async () => await result.current.create(input));

    const stored = secureShareApi.pastes.get(created.pasteId);
    expect(stored?.wrappedKeys.map(key => key.deviceKeyId)).toEqual([keys[0].id, keys[1].id]);
  });

  it('produces a wrapped key each recipient device can actually open', async () => {
    const recipient = await generateDeviceKeyPair();
    const deviceKey = secureShareApi.enrollFakeDevice({ publicKey: recipient.publicKey });
    const input = await inputFor({
      recipients: [{ userEntityRef: 'user:default/bob', viaEntityRefs: ['user:default/bob'], keys: [deviceKey] }],
    });
    const { result } = renderHook(() => useCreatePaste(), { wrapper });

    const created = await act(async () => await result.current.create(input));

    const stored = secureShareApi.pastes.get(created.pasteId);
    const wrappedKey = stored?.wrappedKeys.find(key => key.deviceKeyId === deviceKey.id);
    const dataKey = await unwrapDataKey({ wrappedKey: wrappedKey!, privateKey: recipient.privateKey });
    expect((await openMetadata(stored?.summary.metaCiphertext as string, dataKey)).title).toBe('Staging credentials');
  });

  it('seals the chunk count into the metadata, so truncation is detectable', async () => {
    const recipient = await generateDeviceKeyPair();
    const deviceKey = secureShareApi.enrollFakeDevice({ publicKey: recipient.publicKey });
    const input = await inputFor({
      payload: new Blob([new Uint8Array(2500)]),
      recipients: [{ userEntityRef: 'user:default/bob', viaEntityRefs: ['user:default/bob'], keys: [deviceKey] }],
    });
    const { result } = renderHook(() => useCreatePaste(), { wrapper });

    const created = await act(async () => await result.current.create(input));

    const stored = secureShareApi.pastes.get(created.pasteId);
    const wrappedKey = stored?.wrappedKeys.find(key => key.deviceKeyId === deviceKey.id);
    const dataKey = await unwrapDataKey({ wrappedKey: wrappedKey!, privateKey: recipient.privateKey });
    const metadata = await openMetadata(stored?.summary.metaCiphertext as string, dataKey);
    expect(metadata.chunkCount).toBe(3);
    expect(metadata.plaintextBytes).toBe(2500);
  });

  it('keeps the link token and the key in the fragment, out of the request path', async () => {
    const input = await inputFor({ linkEnabled: true });
    const { result } = renderHook(() => useCreatePaste(), { wrapper });

    const created = await act(async () => await result.current.create(input));

    const url = new URL(created.linkUrl as string);
    expect(url.pathname).toBe(`/secure-share/link/${created.pasteId}`);
    expect(url.search).toBe('');
    const fragment = new URLSearchParams(url.hash.slice(1));
    expect(fragment.get('t')).toBe(secureShareApi.linkToken);
    await expect(importDataKeyFromLink(fragment.get('k') as string)).resolves.toBeDefined();
  });

  it('gives no link when none was asked for', async () => {
    const input = await inputFor({ linkEnabled: false });
    const { result } = renderHook(() => useCreatePaste(), { wrapper });

    const created = await act(async () => await result.current.create(input));

    expect(created.linkUrl).toBeUndefined();
  });

  it('reports upload progress', async () => {
    const input = await inputFor({ payload: new Blob([new Uint8Array(2500)]) });
    const { result } = renderHook(() => useCreatePaste(), { wrapper });

    await act(async () => {
      await result.current.create(input);
    });

    expect(result.current.totalChunks).toBe(3);
    expect(result.current.uploadedChunks).toBe(3);
    expect(result.current.busy).toBe(false);
  });
});
