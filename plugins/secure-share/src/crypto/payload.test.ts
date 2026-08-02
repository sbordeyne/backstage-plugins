import { generateDataKey } from './envelope';
import {
  CHUNK_CRYPTO_OVERHEAD_BYTES,
  computePayloadLayout,
  decryptPayload,
  encryptPayloadChunks,
  openMetadata,
  PasteMetadata,
  sealMetadata,
} from './payload';

const metadata: PasteMetadata = {
  title: 'Staging database password',
  filename: 'creds.txt',
  mimeType: 'text/plain',
  language: 'plaintext',
  chunkCount: 1,
  plaintextBytes: 42,
};

async function collect(chunks: AsyncIterable<{ index: number; data: Uint8Array }>): Promise<Uint8Array[]> {
  const collected: Uint8Array[] = [];
  for await (const chunk of chunks) {
    collected.push(chunk.data);
  }
  return collected;
}

describe('computePayloadLayout', () => {
  it.each([
    [0, 1024, 1, 0 + CHUNK_CRYPTO_OVERHEAD_BYTES],
    [10, 1024, 1, 10 + CHUNK_CRYPTO_OVERHEAD_BYTES],
    [1024, 1024, 1, 1024 + CHUNK_CRYPTO_OVERHEAD_BYTES],
    [1025, 1024, 2, 1025 + 2 * CHUNK_CRYPTO_OVERHEAD_BYTES],
    [4096, 1024, 4, 4096 + 4 * CHUNK_CRYPTO_OVERHEAD_BYTES],
  ])('splits %s bytes into chunks of %s', (plaintextBytes, chunkSizeBytes, chunkCount, ciphertextBytes) => {
    expect(computePayloadLayout({ plaintextBytes, chunkSizeBytes })).toEqual({ chunkCount, ciphertextBytes });
  });

  it('predicts exactly what the encryption produces, which is what the backend is told', async () => {
    const dataKey = await generateDataKey();
    const payload = new Blob([new Uint8Array(2500)]);
    const layout = computePayloadLayout({ plaintextBytes: payload.size, chunkSizeBytes: 1024 });

    const chunks = await collect(encryptPayloadChunks({ payload, dataKey, chunkSizeBytes: 1024 }));

    expect(chunks).toHaveLength(layout.chunkCount);
    expect(chunks.reduce((total, chunk) => total + chunk.length, 0)).toBe(layout.ciphertextBytes);
  });
});

describe('metadata sealing', () => {
  it('round trips metadata', async () => {
    const dataKey = await generateDataKey();

    const sealed = await sealMetadata(metadata, dataKey);

    expect(sealed).not.toContain('Staging');
    expect(await openMetadata(sealed, dataKey)).toEqual(metadata);
  });

  it('cannot be opened with another data key', async () => {
    const sealed = await sealMetadata(metadata, await generateDataKey());

    await expect(openMetadata(sealed, await generateDataKey())).rejects.toThrow();
  });

  it('cannot be opened as if it were a payload chunk', async () => {
    const dataKey = await generateDataKey();
    const sealed = await sealMetadata(metadata, dataKey);

    // Same key, but the chunk context differs, so authentication fails.
    await expect(
      decryptPayload({ chunks: [Buffer.from(sealed, 'base64')], dataKey }).then(blob => blob.text()),
    ).rejects.toThrow();
  });
});

describe('payload encryption', () => {
  it('round trips text', async () => {
    const dataKey = await generateDataKey();
    const payload = new Blob(['the password is hunter2']);

    const chunks = await collect(encryptPayloadChunks({ payload, dataKey, chunkSizeBytes: 1024 }));
    const decrypted = await decryptPayload({ chunks, dataKey });

    expect(await decrypted.text()).toBe('the password is hunter2');
  });

  it('round trips a payload that spans several chunks', async () => {
    const dataKey = await generateDataKey();
    const bytes = new Uint8Array(Array.from({ length: 3000 }, (_, index) => index % 256));
    const payload = new Blob([bytes]);

    const chunks = await collect(encryptPayloadChunks({ payload, dataKey, chunkSizeBytes: 1024 }));
    const decrypted = await decryptPayload({ chunks, dataKey });

    expect(chunks).toHaveLength(3);
    expect(new Uint8Array(await decrypted.arrayBuffer())).toEqual(bytes);
  });

  it('keeps the mime type a reader asks for', async () => {
    const dataKey = await generateDataKey();
    const chunks = await collect(encryptPayloadChunks({ payload: new Blob(['x']), dataKey, chunkSizeBytes: 1024 }));

    const decrypted = await decryptPayload({ chunks, dataKey, mimeType: 'application/pdf' });

    expect(decrypted.type).toBe('application/pdf');
  });

  it('produces different ciphertext for identical chunks', async () => {
    const dataKey = await generateDataKey();
    const payload = new Blob([new Uint8Array(2048)]);

    const [first, second] = await collect(encryptPayloadChunks({ payload, dataKey, chunkSizeBytes: 1024 }));

    expect(Buffer.from(first)).not.toEqual(Buffer.from(second));
  });

  it('refuses chunks that have been reordered', async () => {
    const dataKey = await generateDataKey();
    const payload = new Blob([new Uint8Array(2048)]);
    const chunks = await collect(encryptPayloadChunks({ payload, dataKey, chunkSizeBytes: 1024 }));

    await expect(decryptPayload({ chunks: [chunks[1], chunks[0]], dataKey })).rejects.toThrow();
  });

  it('refuses a chunk that has been tampered with', async () => {
    const dataKey = await generateDataKey();
    const chunks = await collect(
      encryptPayloadChunks({ payload: new Blob(['secret']), dataKey, chunkSizeBytes: 1024 }),
    );
    chunks[0][chunks[0].length - 1] ^= 0xff;

    await expect(decryptPayload({ chunks, dataKey })).rejects.toThrow();
  });

  it('refuses a chunk that is too short to hold an iv and a tag', async () => {
    const dataKey = await generateDataKey();

    await expect(decryptPayload({ chunks: [new Uint8Array(8)], dataKey })).rejects.toThrow(/too short/);
  });

  it('cannot be read with a different data key', async () => {
    const chunks = await collect(
      encryptPayloadChunks({ payload: new Blob(['secret']), dataKey: await generateDataKey(), chunkSizeBytes: 1024 }),
    );

    await expect(decryptPayload({ chunks, dataKey: await generateDataKey() })).rejects.toThrow();
  });

  it('detects a truncated payload through the sealed chunk count', async () => {
    const dataKey = await generateDataKey();
    const payload = new Blob([new Uint8Array(2048)]);
    const layout = computePayloadLayout({ plaintextBytes: payload.size, chunkSizeBytes: 1024 });
    const sealed = await sealMetadata({ ...metadata, chunkCount: layout.chunkCount }, dataKey);
    const chunks = await collect(encryptPayloadChunks({ payload, dataKey, chunkSizeBytes: 1024 }));

    // A backend that drops the last chunk cannot also change the sealed metadata.
    const truncated = chunks.slice(0, 1);
    const opened = await openMetadata(sealed, dataKey);
    expect(opened.chunkCount).toBe(2);
    expect(truncated).toHaveLength(1);
  });
});
