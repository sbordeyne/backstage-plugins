import {
  exportDataKeyForLink,
  generateDataKey,
  importDataKeyFromLink,
  unwrapDataKey,
  wrapDataKeyFor,
} from './envelope';
import { fromBase64, generateDeviceKeyPair, toBase64 } from './keys';

const DEVICE_KEY_ID = '11111111-1111-4111-8111-111111111111';

async function encryptWith(dataKey: CryptoKey, plaintext: string): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, dataKey, new TextEncoder().encode(plaintext));
  const sealed = new Uint8Array(12 + ciphertext.byteLength);
  sealed.set(iv);
  sealed.set(new Uint8Array(ciphertext), 12);
  return sealed;
}

async function decryptWith(dataKey: CryptoKey, sealed: Uint8Array): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: sealed.slice(0, 12) },
    dataKey,
    sealed.slice(12),
  );
  return new TextDecoder().decode(plaintext);
}

describe('wrapDataKeyFor', () => {
  it('lets the intended recipient unwrap the data key', async () => {
    const recipient = await generateDeviceKeyPair();
    const dataKey = await generateDataKey();
    const sealed = await encryptWith(dataKey, 'the password is hunter2');

    const wrappedKey = await wrapDataKeyFor({
      dataKey,
      recipientPublicKey: recipient.publicKey,
      deviceKeyId: DEVICE_KEY_ID,
    });
    const unwrapped = await unwrapDataKey({ wrappedKey, privateKey: recipient.privateKey });

    expect(await decryptWith(unwrapped, sealed)).toBe('the password is hunter2');
  });

  it('carries the device it was wrapped for and a fresh ephemeral key each time', async () => {
    const recipient = await generateDeviceKeyPair();
    const dataKey = await generateDataKey();

    const first = await wrapDataKeyFor({
      dataKey,
      recipientPublicKey: recipient.publicKey,
      deviceKeyId: DEVICE_KEY_ID,
    });
    const second = await wrapDataKeyFor({
      dataKey,
      recipientPublicKey: recipient.publicKey,
      deviceKeyId: DEVICE_KEY_ID,
    });

    expect(first.deviceKeyId).toBe(DEVICE_KEY_ID);
    expect(first.ephemeralPublicKey).toEqual({ kty: 'EC', crv: 'P-256', x: expect.any(String), y: expect.any(String) });
    expect(second.ephemeralPublicKey).not.toEqual(first.ephemeralPublicKey);
    expect(second.wrappedKey).not.toBe(first.wrappedKey);
  });

  it('wraps one data key for several recipients independently', async () => {
    const [alice, bob] = [await generateDeviceKeyPair(), await generateDeviceKeyPair()];
    const dataKey = await generateDataKey();
    const sealed = await encryptWith(dataKey, 'shared secret');

    const forAlice = await wrapDataKeyFor({
      dataKey,
      recipientPublicKey: alice.publicKey,
      deviceKeyId: DEVICE_KEY_ID,
    });
    const forBob = await wrapDataKeyFor({ dataKey, recipientPublicKey: bob.publicKey, deviceKeyId: DEVICE_KEY_ID });

    expect(await decryptWith(await unwrapDataKey({ wrappedKey: forAlice, privateKey: alice.privateKey }), sealed)).toBe(
      'shared secret',
    );
    expect(await decryptWith(await unwrapDataKey({ wrappedKey: forBob, privateKey: bob.privateKey }), sealed)).toBe(
      'shared secret',
    );
  });

  it('cannot be unwrapped by another device', async () => {
    const recipient = await generateDeviceKeyPair();
    const eavesdropper = await generateDeviceKeyPair();
    const dataKey = await generateDataKey();

    const wrappedKey = await wrapDataKeyFor({
      dataKey,
      recipientPublicKey: recipient.publicKey,
      deviceKeyId: DEVICE_KEY_ID,
    });

    await expect(unwrapDataKey({ wrappedKey, privateKey: eavesdropper.privateKey })).rejects.toThrow();
  });

  it('fails to unwrap when the wrapped key has been tampered with', async () => {
    const recipient = await generateDeviceKeyPair();
    const dataKey = await generateDataKey();
    const wrappedKey = await wrapDataKeyFor({
      dataKey,
      recipientPublicKey: recipient.publicKey,
      deviceKeyId: DEVICE_KEY_ID,
    });

    const bytes = fromBase64(wrappedKey.wrappedKey);
    bytes[bytes.length - 1] ^= 0xff;

    await expect(
      unwrapDataKey({ wrappedKey: { ...wrappedKey, wrappedKey: toBase64(bytes) }, privateKey: recipient.privateKey }),
    ).rejects.toThrow();
  });

  it('fails to unwrap when the ephemeral public key has been substituted', async () => {
    const recipient = await generateDeviceKeyPair();
    const attacker = await generateDeviceKeyPair();
    const dataKey = await generateDataKey();
    const wrappedKey = await wrapDataKeyFor({
      dataKey,
      recipientPublicKey: recipient.publicKey,
      deviceKeyId: DEVICE_KEY_ID,
    });

    await expect(
      unwrapDataKey({
        wrappedKey: { ...wrappedKey, ephemeralPublicKey: attacker.publicKey },
        privateKey: recipient.privateKey,
      }),
    ).rejects.toThrow();
  });

  it('produces an unwrapped key that cannot be exported again', async () => {
    const recipient = await generateDeviceKeyPair();
    const dataKey = await generateDataKey();
    const wrappedKey = await wrapDataKeyFor({
      dataKey,
      recipientPublicKey: recipient.publicKey,
      deviceKeyId: DEVICE_KEY_ID,
    });

    const unwrapped = await unwrapDataKey({ wrappedKey, privateKey: recipient.privateKey });

    expect(unwrapped.extractable).toBe(false);
  });
});

describe('secret link keys', () => {
  it('round trips a data key through a link fragment', async () => {
    const dataKey = await generateDataKey();
    const sealed = await encryptWith(dataKey, 'link shared secret');

    const fragment = await exportDataKeyForLink(dataKey);
    const imported = await importDataKeyFromLink(fragment);

    expect(fragment).not.toMatch(/[+/=]/);
    expect(await decryptWith(imported, sealed)).toBe('link shared secret');
  });

  it('rejects a fragment key that decrypts nothing', async () => {
    const dataKey = await generateDataKey();
    const sealed = await encryptWith(dataKey, 'link shared secret');
    const otherKey = await importDataKeyFromLink(await exportDataKeyForLink(await generateDataKey()));

    await expect(decryptWith(otherKey, sealed)).rejects.toThrow();
  });
});
