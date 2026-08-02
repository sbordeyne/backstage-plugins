import { canonicalizePublicKeyForThumbprint, EcdhPublicKeyJwk } from '@sbordeyne/secure-share-common';
import { createHash } from 'crypto';

/**
 * Computes the RFC 7638 thumbprint of a device public key.
 *
 * Always recomputed from the key itself: a fingerprint sent by a client is a claim,
 * not evidence, and pinning would be worthless if the server stored it unchecked.
 *
 * @public
 */
export function computeKeyFingerprint(publicKey: EcdhPublicKeyJwk): string {
  return createHash('sha256').update(canonicalizePublicKeyForThumbprint(publicKey)).digest('base64url');
}
