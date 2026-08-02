import { DeviceKeyStorage } from './DeviceKeyStorage';
import { generateDeviceKeyPair } from './keys';

describe('DeviceKeyStorage', () => {
  const storage = DeviceKeyStorage.create();

  afterEach(async () => {
    await storage.clear();
  });

  it('has nothing stored in a fresh browser', async () => {
    expect(await storage.load()).toBeUndefined();
  });

  it('stores and returns a device key, keeping the private key usable', async () => {
    const keyPair = await generateDeviceKeyPair();

    await storage.save({ ...keyPair, fingerprint: 'abc', deviceKeyId: 'key-1' });
    const loaded = await storage.load();

    expect(loaded?.publicKey).toEqual(keyPair.publicKey);
    expect(loaded?.fingerprint).toBe('abc');
    expect(loaded?.deviceKeyId).toBe('key-1');
    // The stored key must still be usable for a key agreement, or nothing can be read.
    await expect(
      crypto.subtle.deriveBits(
        {
          name: 'ECDH',
          public: await crypto.subtle.importKey(
            'jwk',
            keyPair.publicKey,
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            [],
          ),
        },
        loaded?.privateKey as CryptoKey,
        256,
      ),
    ).resolves.toBeDefined();
  });

  it('keeps the private key non-extractable across a save and load', async () => {
    const keyPair = await generateDeviceKeyPair();

    await storage.save({ ...keyPair, fingerprint: 'abc' });
    const loaded = await storage.load();

    expect(loaded?.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('jwk', loaded?.privateKey as CryptoKey)).rejects.toThrow();
  });

  it('replaces the stored key rather than accumulating keys', async () => {
    const first = await generateDeviceKeyPair();
    const second = await generateDeviceKeyPair();

    await storage.save({ ...first, fingerprint: 'first' });
    await storage.save({ ...second, fingerprint: 'second' });

    expect((await storage.load())?.fingerprint).toBe('second');
  });

  it('forgets the key, which is what clearing site data does', async () => {
    await storage.save({ ...(await generateDeviceKeyPair()), fingerprint: 'abc' });

    await storage.clear();

    expect(await storage.load()).toBeUndefined();
  });
});
