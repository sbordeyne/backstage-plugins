import { configApiRef } from '@backstage/core-plugin-api';
import { mockApis, renderInTestApp, TestApiProvider } from '@backstage/test-utils';
import { screen } from '@testing-library/react';
import { secureShareApiRef } from '../../api';
import { DeviceKeyStorage, generateDeviceKeyPair, wrapDataKeyFor } from '../../crypto';
import { generateDataKey } from '../../crypto/envelope';
import { sealMetadata } from '../../crypto/payload';
import { createFakeSecureShareApi, FakeSecureShareApi } from '../../testHelpers/fakeSecureShareApi';
import { SharedWithMeCard } from './SharedWithMeCard';

const configApi = mockApis.config({ data: { secureShare: { card: { limit: 2 } } } });
const IN_AN_HOUR = new Date(Date.now() + 60 * 60 * 1000).toISOString();

describe('SharedWithMeCard', () => {
  let secureShareApi: FakeSecureShareApi;
  const storage = DeviceKeyStorage.create();

  async function renderCard(): Promise<void> {
    await renderInTestApp(
      <TestApiProvider
        apis={[
          [secureShareApiRef, secureShareApi],
          [configApiRef, configApi],
        ]}
      >
        <SharedWithMeCard />
      </TestApiProvider>,
    );
  }

  /** Enrolls this browser and shares a paste with it, the way a sender would. */
  async function shareWithThisBrowser(options: { title: string; burnAfterRead?: boolean }): Promise<void> {
    const keyPair = await generateDeviceKeyPair();
    const deviceKey = secureShareApi.enrollFakeDevice({ publicKey: keyPair.publicKey });
    await storage.save({ ...keyPair, fingerprint: deviceKey.fingerprint, deviceKeyId: deviceKey.id });

    const dataKey = await generateDataKey();
    const wrappedKey = await wrapDataKeyFor({
      dataKey,
      recipientPublicKey: keyPair.publicKey,
      deviceKeyId: deviceKey.id,
    });
    const { id } = await secureShareApi.createPaste({
      kind: 'text',
      metaCiphertext: await sealMetadata(
        { title: options.title, chunkCount: 1, plaintextBytes: 7, mimeType: 'text/plain' },
        dataKey,
      ),
      chunkCount: 1,
      sizeBytes: 35,
      expiresAt: IN_AN_HOUR,
      burnAfterRead: options.burnAfterRead ?? false,
      linkEnabled: false,
      recipientEntityRefs: ['user:default/bob'],
      wrappedKeys: [wrappedKey],
    });
    await secureShareApi.finalizePaste(id);
  }

  beforeEach(async () => {
    secureShareApi = createFakeSecureShareApi();
    await storage.clear();
  });

  it('asks an unenrolled browser to enroll, since it could not decrypt anything', async () => {
    await renderCard();

    expect(await screen.findByText('Enroll this browser')).toBeInTheDocument();
  });

  it('says so when nothing has been shared', async () => {
    const keyPair = await generateDeviceKeyPair();
    const deviceKey = secureShareApi.enrollFakeDevice({ publicKey: keyPair.publicKey });
    await storage.save({ ...keyPair, fingerprint: deviceKey.fingerprint, deviceKeyId: deviceKey.id });

    await renderCard();

    expect(await screen.findByText('Nothing has been shared with you yet.')).toBeInTheDocument();
  });

  it('decrypts the titles of what was shared and links to each paste', async () => {
    await shareWithThisBrowser({ title: 'Staging database password', burnAfterRead: true });

    await renderCard();

    const link = await screen.findByRole('link', { name: 'Staging database password' });
    expect(link).toHaveAttribute('href', expect.stringContaining('/secure-share/paste/'));
    expect(screen.getByText(/from alice · expires in 1 hour/)).toBeInTheDocument();
    expect(screen.getByText('burns after reading')).toBeInTheDocument();
  });

  it('marks an entry this browser cannot decrypt instead of hiding the list', async () => {
    await shareWithThisBrowser({ title: 'Readable' });
    const [stored] = [...secureShareApi.pastes.values()];
    stored.summary = { ...stored.summary, metaCiphertext: Buffer.from('forged').toString('base64') };

    await renderCard();

    expect(await screen.findByText('Cannot be decrypted by this browser')).toBeInTheDocument();
  });

  it('surfaces a failure to list', async () => {
    const keyPair = await generateDeviceKeyPair();
    const deviceKey = secureShareApi.enrollFakeDevice({ publicKey: keyPair.publicKey });
    await storage.save({ ...keyPair, fingerprint: deviceKey.fingerprint, deviceKeyId: deviceKey.id });
    secureShareApi.listSharedWithMe = jest.fn().mockRejectedValue(new Error('backend down'));

    await renderCard();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
