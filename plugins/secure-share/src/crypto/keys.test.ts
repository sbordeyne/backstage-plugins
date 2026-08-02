import { canonicalizePublicKeyForThumbprint } from '@sbordeyne/secure-share-common';
// eslint-disable-next-line no-restricted-imports -- verifies the browser digest against the backend's
import { createHash } from 'crypto';
import {
  computeFingerprint,
  exportPublicKey,
  fromBase64,
  fromBase64Url,
  generateDeviceKeyPair,
  importPublicKey,
  toBase64,
  toBase64Url,
} from './keys';

describe('generateDeviceKeyPair', () => {
  it('produces a P-256 key pair whose private half cannot be exported', async () => {
    const keyPair = await generateDeviceKeyPair();

    expect(keyPair.publicKey).toEqual({
      kty: 'EC',
      crv: 'P-256',
      x: expect.any(String),
      y: expect.any(String),
    });
    expect(keyPair.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('jwk', keyPair.privateKey)).rejects.toThrow();
  });

  it('exports only the four JWK members that identify the key', async () => {
    const keyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);

    const exported = await exportPublicKey(keyPair.publicKey);

    expect(Object.keys(exported).sort()).toEqual(['crv', 'kty', 'x', 'y']);
  });

  it('round trips a public key through an import', async () => {
    const keyPair = await generateDeviceKeyPair();

    const imported = await importPublicKey(keyPair.publicKey);

    expect(await exportPublicKey(imported)).toEqual(keyPair.publicKey);
  });

  it('refuses a key that is not EC P-256', async () => {
    const rsaKeyPair = await crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['encrypt', 'decrypt'],
    );

    await expect(exportPublicKey(rsaKeyPair.publicKey)).rejects.toThrow(/EC P-256/);
  });
});

describe('computeFingerprint', () => {
  it('matches the digest the backend derives with node:crypto', async () => {
    const { publicKey } = await generateDeviceKeyPair();

    const fingerprint = await computeFingerprint(publicKey);

    const backendFingerprint = createHash('sha256')
      .update(canonicalizePublicKeyForThumbprint(publicKey))
      .digest('base64url');
    expect(fingerprint).toBe(backendFingerprint);
  });

  it('differs between two keys', async () => {
    const first = await generateDeviceKeyPair();
    const second = await generateDeviceKeyPair();

    expect(await computeFingerprint(first.publicKey)).not.toBe(await computeFingerprint(second.publicKey));
  });
});

describe('base64 helpers', () => {
  it.each([
    [new Uint8Array([])],
    [new Uint8Array([0])],
    [new Uint8Array([255, 254, 253])],
    [new Uint8Array(Array.from({ length: 32 }, (_, index) => index * 7))],
  ])('round trips %p through base64', bytes => {
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
  });

  it.each([
    [new Uint8Array([251, 255, 191])],
    [new Uint8Array([1])],
    [new Uint8Array([1, 2])],
    [new Uint8Array(Array.from({ length: 32 }, (_, index) => 255 - index))],
  ])('round trips %p through base64url', bytes => {
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
  });

  it('produces url safe output with no padding', () => {
    const encoded = toBase64Url(new Uint8Array([251, 255, 191, 1]));

    expect(encoded).not.toMatch(/[+/=]/);
  });
});
