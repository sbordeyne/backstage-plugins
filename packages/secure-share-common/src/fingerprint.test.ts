import { canonicalizePublicKeyForThumbprint, formatFingerprint } from './fingerprint';
import { EcdhPublicKeyJwk } from './types';

const publicKey: EcdhPublicKeyJwk = {
  kty: 'EC',
  crv: 'P-256',
  x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU',
  y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0',
};

describe('canonicalizePublicKeyForThumbprint', () => {
  it('orders members lexicographically and omits whitespace, as RFC 7638 requires', () => {
    expect(canonicalizePublicKeyForThumbprint(publicKey)).toBe(
      '{"crv":"P-256","kty":"EC","x":"f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU","y":"x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0"}',
    );
  });

  it('ignores members that are not part of the thumbprint', () => {
    const withExtras = { ...publicKey, ext: true, key_ops: [] } as EcdhPublicKeyJwk;

    expect(canonicalizePublicKeyForThumbprint(withExtras)).toBe(canonicalizePublicKeyForThumbprint(publicKey));
  });

  it.each([
    { ...publicKey, kty: 'RSA' },
    { ...publicKey, crv: 'P-384' },
    { ...publicKey, x: '' },
    { ...publicKey, y: undefined },
  ])('rejects a key that is not an EC P-256 pair (%p)', invalid => {
    expect(() => canonicalizePublicKeyForThumbprint(invalid as EcdhPublicKeyJwk)).toThrow(/EC P-256 JWK/);
  });
});

describe('formatFingerprint', () => {
  it('renders four short groups', () => {
    expect(formatFingerprint('abcdefghijklmnopqrstuvwxyz')).toBe('abcd-efgh-ijkl-mnop');
  });

  it('drops groups that the digest is too short to fill', () => {
    expect(formatFingerprint('abcdef')).toBe('abcd-ef');
  });
});
