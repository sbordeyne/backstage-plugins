import { fromBase64, toBase64 } from './keys';

const IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

/** Every chunk carries its own iv and authentication tag. */
export const CHUNK_CRYPTO_OVERHEAD_BYTES = IV_BYTES + GCM_TAG_BYTES;

const METADATA_CONTEXT = 'secure-share/v1|metadata';

/**
 * What a paste is, as opposed to what it contains. Sealed with the data key, so the
 * backend stores a title it cannot read.
 *
 * `chunkCount` and `plaintextBytes` are inside the sealed blob on purpose: the same
 * numbers are also returned unauthenticated by the backend, and comparing the two is
 * what lets a reader notice a truncated or padded payload.
 *
 * @public
 */
export interface PasteMetadata {
  title: string;
  filename?: string;
  mimeType?: string;
  language?: string;
  markdown?: boolean;
  chunkCount: number;
  plaintextBytes: number;
}

/** @public */
export interface EncryptedChunk {
  index: number;
  data: Uint8Array;
}

/** @public */
export interface PayloadLayout {
  chunkCount: number;
  ciphertextBytes: number;
}

/**
 * Works out how a payload will be split before any encryption happens, because the
 * backend has to be told the chunk count and ciphertext size when the paste is created.
 *
 * @public
 */
export function computePayloadLayout(options: { plaintextBytes: number; chunkSizeBytes: number }): PayloadLayout {
  const chunkCount = Math.max(1, Math.ceil(options.plaintextBytes / options.chunkSizeBytes));
  return {
    chunkCount,
    ciphertextBytes: options.plaintextBytes + chunkCount * CHUNK_CRYPTO_OVERHEAD_BYTES,
  };
}

/** @public */
export async function sealMetadata(metadata: PasteMetadata, dataKey: CryptoKey): Promise<string> {
  const plaintext = new TextEncoder().encode(JSON.stringify(metadata));
  return toBase64(await encrypt({ plaintext, dataKey, context: METADATA_CONTEXT }));
}

/** @public */
export async function openMetadata(metaCiphertext: string, dataKey: CryptoKey): Promise<PasteMetadata> {
  const plaintext = await decrypt({ sealed: fromBase64(metaCiphertext), dataKey, context: METADATA_CONTEXT });
  // Sealed by this plugin and authenticated by AES-GCM, so the shape is known.
  return JSON.parse(new TextDecoder().decode(plaintext)) as PasteMetadata;
}

/**
 * Encrypts a payload chunk by chunk, yielding each one as it is produced so that a large
 * file is never held in memory in full.
 *
 * @public
 */
export async function* encryptPayloadChunks(options: {
  payload: Blob;
  dataKey: CryptoKey;
  chunkSizeBytes: number;
}): AsyncGenerator<EncryptedChunk> {
  const { chunkCount } = computePayloadLayout({
    plaintextBytes: options.payload.size,
    chunkSizeBytes: options.chunkSizeBytes,
  });

  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * options.chunkSizeBytes;
    const slice = options.payload.slice(start, start + options.chunkSizeBytes);
    const plaintext = new Uint8Array(await slice.arrayBuffer());
    yield {
      index,
      data: await encrypt({ plaintext, dataKey: options.dataKey, context: chunkContext(index) }),
    };
  }
}

/**
 * Decrypts chunks back into a payload.
 *
 * Each chunk is bound to its position, so a reordered or substituted chunk fails to
 * authenticate rather than decrypting to plausible nonsense.
 *
 * @public
 */
export async function decryptPayload(options: {
  chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
  dataKey: CryptoKey;
  mimeType?: string;
}): Promise<Blob> {
  const parts: Uint8Array[] = [];
  let index = 0;
  for await (const chunk of options.chunks) {
    parts.push(await decrypt({ sealed: chunk, dataKey: options.dataKey, context: chunkContext(index) }));
    index += 1;
  }
  return new Blob(parts, options.mimeType ? { type: options.mimeType } : undefined);
}

async function encrypt(options: { plaintext: Uint8Array; dataKey: CryptoKey; context: string }): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(options.context) },
    options.dataKey,
    options.plaintext,
  );
  const sealed = new Uint8Array(IV_BYTES + ciphertext.byteLength);
  sealed.set(iv);
  sealed.set(new Uint8Array(ciphertext), IV_BYTES);
  return sealed;
}

async function decrypt(options: { sealed: Uint8Array; dataKey: CryptoKey; context: string }): Promise<Uint8Array> {
  if (options.sealed.length < IV_BYTES + GCM_TAG_BYTES) {
    throw new Error('Ciphertext is too short to be valid');
  }
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: options.sealed.slice(0, IV_BYTES),
      additionalData: new TextEncoder().encode(options.context),
    },
    options.dataKey,
    options.sealed.slice(IV_BYTES),
  );
  return new Uint8Array(plaintext);
}

function chunkContext(index: number): string {
  return `secure-share/v1|chunk|${index}`;
}
