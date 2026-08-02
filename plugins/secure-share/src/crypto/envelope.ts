import { EcdhPublicKeyJwk, WrappedKey } from '@sbordeyne/secure-share-common';
import { fromBase64, importPublicKey, toBase64, toBase64Url, fromBase64Url } from './keys';

const DATA_KEY_ALGORITHM: AesKeyGenParams = { name: 'AES-GCM', length: 256 };
const IV_BYTES = 12;

/**
 * Domain separation for the key derivation, so a shared secret derived here can never be
 * mistaken for one derived for another purpose.
 */
const WRAP_INFO = new TextEncoder().encode('secure-share/v1/data-key-wrap');

/**
 * Creates the data key that encrypts one paste. Extractable because the sender has to
 * wrap it for each recipient, and may have to put it in a secret link.
 *
 * @public
 */
export async function generateDataKey(): Promise<CryptoKey> {
  return await crypto.subtle.generateKey(DATA_KEY_ALGORITHM, true, ['encrypt', 'decrypt']);
}

/**
 * Wraps a data key so that only the holder of `recipientPublicKey` can unwrap it.
 *
 * A throwaway key pair is generated per recipient device and its public half is stored
 * alongside the wrapped key. The wrapping key therefore exists only in the sender's
 * browser and in the recipient's; the backend sees neither.
 *
 * @public
 */
export async function wrapDataKeyFor(options: {
  dataKey: CryptoKey;
  recipientPublicKey: EcdhPublicKeyJwk;
  deviceKeyId: string;
}): Promise<WrappedKey> {
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const wrappingKey = await deriveWrappingKey({
    privateKey: ephemeral.privateKey,
    publicKey: await importPublicKey(options.recipientPublicKey),
  });

  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const rawDataKey = await crypto.subtle.exportKey('raw', options.dataKey);
  const wrapped = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, rawDataKey);

  const exportedEphemeral = await crypto.subtle.exportKey('jwk', ephemeral.publicKey);
  return {
    deviceKeyId: options.deviceKeyId,
    ephemeralPublicKey: {
      kty: 'EC',
      crv: 'P-256',
      x: exportedEphemeral.x as string,
      y: exportedEphemeral.y as string,
    },
    wrappedKey: toBase64(concat(iv, new Uint8Array(wrapped))),
  };
}

/**
 * Unwraps a data key with this browser's device private key.
 *
 * @public
 */
export async function unwrapDataKey(options: { wrappedKey: WrappedKey; privateKey: CryptoKey }): Promise<CryptoKey> {
  const wrappingKey = await deriveWrappingKey({
    privateKey: options.privateKey,
    publicKey: await importPublicKey(options.wrappedKey.ephemeralPublicKey),
  });

  const bytes = fromBase64(options.wrappedKey.wrappedKey);
  const rawDataKey = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, IV_BYTES) },
    wrappingKey,
    bytes.slice(IV_BYTES),
  );
  return await crypto.subtle.importKey('raw', rawDataKey, DATA_KEY_ALGORITHM, false, ['encrypt', 'decrypt']);
}

/**
 * Exports a data key for a secret link. The result belongs in a URL fragment, which
 * browsers never send to a server.
 *
 * @public
 */
export async function exportDataKeyForLink(dataKey: CryptoKey): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', dataKey)));
}

/** @public */
export async function importDataKeyFromLink(rawKey: string): Promise<CryptoKey> {
  return await crypto.subtle.importKey('raw', fromBase64Url(rawKey), DATA_KEY_ALGORITHM, false, ['encrypt', 'decrypt']);
}

async function deriveWrappingKey(options: { privateKey: CryptoKey; publicKey: CryptoKey }): Promise<CryptoKey> {
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: options.publicKey },
    options.privateKey,
    256,
  );
  const hkdfKey = await crypto.subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey']);
  return await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: WRAP_INFO },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}
