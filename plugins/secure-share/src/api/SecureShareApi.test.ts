import { DiscoveryApi, FetchApi } from '@backstage/core-plugin-api';
import { SecureShareClient } from './SecureShareApi';

const BASE_URL = 'http://backstage/api/secure-share';
const PASTE_ID = 'AAAAAAAAAAAAAAAAAAAAAA';

describe('SecureShareClient', () => {
  const fetchMock = jest.fn();
  const client = new SecureShareClient({
    discoveryApi: { getBaseUrl: async () => BASE_URL } as DiscoveryApi,
    fetchApi: { fetch: fetchMock } as unknown as FetchApi,
  });

  function jsonResponse(body: unknown): Response {
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('sends a paste as JSON', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: PASTE_ID }));

    const response = await client.createPaste({
      kind: 'text',
      metaCiphertext: 'sealed',
      chunkCount: 1,
      sizeBytes: 38,
      expiresAt: '2026-08-02T10:00:00.000Z',
      burnAfterRead: true,
      linkEnabled: false,
      recipientEntityRefs: ['user:default/bob'],
      wrappedKeys: [],
    });

    expect(response).toEqual({ id: PASTE_ID });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/pastes`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('uploads a chunk as an opaque octet stream', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await client.uploadChunk({ pasteId: PASTE_ID, index: 2, data: new Uint8Array([1, 2, 3]) });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/pastes/${PASTE_ID}/chunks/2`);
    expect(init.method).toBe('PUT');
    expect(init.headers).toEqual({ 'Content-Type': 'application/octet-stream' });
    expect(new Uint8Array(init.body)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('sends only the requested bytes of a chunk view', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const backing = new Uint8Array([9, 9, 1, 2, 9, 9]);

    await client.uploadChunk({ pasteId: PASTE_ID, index: 0, data: backing.subarray(2, 4) });

    expect(new Uint8Array(fetchMock.mock.calls[0][1].body)).toEqual(new Uint8Array([1, 2]));
  });

  it('reads ciphertext back as bytes', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([4, 5, 6]), { status: 200 }));

    const chunk = await client.fetchChunk({ pasteId: PASTE_ID, index: 1, deviceKeyId: 'device-1' });

    expect(chunk).toEqual(new Uint8Array([4, 5, 6]));
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE_URL}/pastes/${PASTE_ID}/chunks/1?deviceKeyId=device-1`);
  });

  it('passes the device key when listing what is shared with me', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await client.listSharedWithMe({ deviceKeyId: 'device-1', limit: 5 });

    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE_URL}/pastes/shared-with-me?deviceKeyId=device-1&limit=5`);
  });

  it('omits the limit when none is given', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await client.listSharedWithMe({ deviceKeyId: 'device-1' });

    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE_URL}/pastes/shared-with-me?deviceKeyId=device-1`);
  });

  it('sends a link token in a header rather than the query string', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ paste: { id: PASTE_ID } }));

    await client.readLinkedPaste({ pasteId: PASTE_ID, linkToken: 'secret-token' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/link/${PASTE_ID}`);
    expect(url).not.toContain('secret-token');
    expect(init.headers).toEqual({ 'x-secure-share-link-token': 'secret-token' });
  });

  it('fetches linked ciphertext with the same header', async () => {
    fetchMock.mockResolvedValue(new Response(new Uint8Array([7]), { status: 200 }));

    await client.fetchLinkedChunk({ pasteId: PASTE_ID, index: 3, linkToken: 'secret-token' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/link/${PASTE_ID}/chunks/3`);
    expect(init.headers).toEqual({ 'x-secure-share-link-token': 'secret-token' });
  });

  it('turns a backend error into a ResponseError carrying the status', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { name: 'NotFoundError', message: 'gone' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(client.readPaste({ pasteId: PASTE_ID, deviceKeyId: 'device-1' })).rejects.toMatchObject({
      name: 'ResponseError',
      statusCode: 404,
    });
  });

  it('escapes a paste id in the path', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await client.deletePaste('../../device-keys');

    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE_URL}/pastes/..%2F..%2Fdevice-keys`);
  });
});
