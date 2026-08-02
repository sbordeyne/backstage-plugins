import { canonicalizePublicKeyForThumbprint, EcdhPublicKeyJwk } from '@sbordeyne/secure-share-common';

const KEY_ALGORITHM: EcKeyGenParams = { name: 'ECDH', namedCurve: 'P-256' };

/**
 * A device key pair. The private half is generated non-extractable, so its bytes cannot
 * be read back by any code running on the page, including this plugin.
 *
 * @public
 */
export interface DeviceKeyPair {
  publicKey: EcdhPublicKeyJwk;
  privateKey: CryptoKey;
}

/**
 * Generates a device key pair for this browser.
 *
 * @public
 */
export async function generateDeviceKeyPair(): Promise<DeviceKeyPair> {
  const keyPair = await crypto.subtle.generateKey(KEY_ALGORITHM, false, ['deriveKey', 'deriveBits']);
  return {
    publicKey: await exportPublicKey(keyPair.publicKey),
    privateKey: keyPair.privateKey,
  };
}

/**
 * Exports the public half as the four JWK members that identify it, dropping the `ext`
 * and `key_ops` members WebCrypto adds.
 *
 * @public
 */
export async function exportPublicKey(publicKey: CryptoKey): Promise<EcdhPublicKeyJwk> {
  const jwk = await crypto.subtle.exportKey('jwk', publicKey);
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) {
    throw new Error('Expected an EC P-256 public key');
  }
  return { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
}

/** @public */
export async function importPublicKey(publicKey: EcdhPublicKeyJwk): Promise<CryptoKey> {
  return await crypto.subtle.importKey('jwk', publicKey, KEY_ALGORITHM, true, []);
}

/**
 * Computes the RFC 7638 thumbprint of a public key, the same value the backend derives
 * with node:crypto, so a fingerprint shown here is comparable to the stored one.
 *
 * @public
 */
export async function computeFingerprint(publicKey: EcdhPublicKeyJwk): Promise<string> {
  const canonical = new TextEncoder().encode(canonicalizePublicKeyForThumbprint(publicKey));
  const digest = await crypto.subtle.digest('SHA-256', canonical);
  return toBase64Url(new Uint8Array(digest));
}

/** @public */
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** @public */
export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  return fromBase64(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
}

/** @public */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** @public */
export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
