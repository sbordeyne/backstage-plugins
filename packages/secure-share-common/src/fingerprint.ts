import { InputError } from '@backstage/errors';
import { EcdhPublicKeyJwk } from './types';

const FINGERPRINT_DISPLAY_GROUPS = 4;
const FINGERPRINT_GROUP_LENGTH = 4;

/**
 * Builds the canonical JSON representation of an ECDH public key, as defined by
 * the JWK thumbprint spec (RFC 7638): only the required members, lexicographically
 * ordered, no insignificant whitespace.
 *
 * Both the browser (WebCrypto) and the backend (node:crypto) hash this exact
 * string, so a fingerprint computed on either side is comparable. Hashing is left
 * to the caller because the two platforms expose different digest APIs.
 *
 * @public
 */
export function canonicalizePublicKeyForThumbprint(publicKey: EcdhPublicKeyJwk): string {
  const { kty, crv, x, y } = publicKey;
  if (kty !== 'EC' || crv !== 'P-256' || !x || !y) {
    throw new InputError('Public key must be an EC P-256 JWK with both x and y coordinates');
  }
  return JSON.stringify({ crv, kty, x, y });
}

/**
 * Renders a fingerprint as short dash separated groups, so that a human can
 * compare two keys out of band without reading the full digest.
 *
 * @public
 */
export function formatFingerprint(fingerprint: string): string {
  const groups: string[] = [];
  for (let group = 0; group < FINGERPRINT_DISPLAY_GROUPS; group += 1) {
    const start = group * FINGERPRINT_GROUP_LENGTH;
    groups.push(fingerprint.slice(start, start + FINGERPRINT_GROUP_LENGTH));
  }
  return groups.filter(group => group.length > 0).join('-');
}
