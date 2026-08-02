import { mockCredentials, mockErrorHandler, mockServices } from '@backstage/backend-test-utils';
import { EcdhPublicKeyJwk } from '@sbordeyne/secure-share-common';
import express from 'express';
import { Readable } from 'stream';
import request from 'supertest';
import { createRouter } from './router';
import { DeviceKeyService } from './services/DeviceKeyService';
import { PasteService } from './services/PasteService';

const publicKey: EcdhPublicKeyJwk = {
  kty: 'EC',
  crv: 'P-256',
  x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU',
  y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0',
};

const DEVICE_KEY_ID = '11111111-1111-4111-8111-111111111111';
const PASTE_ID = 'AAAAAAAAAAAAAAAAAAAAAA';
const MAX_CHUNK_BYTES = 1024;

const createPasteBody = {
  kind: 'text' as const,
  metaCiphertext: 'sealed-metadata',
  chunkCount: 1,
  sizeBytes: 128,
  expiresAt: '2026-08-02T10:00:00.000Z',
  burnAfterRead: true,
  linkEnabled: false,
  recipientEntityRefs: ['user:default/bob'],
  wrappedKeys: [{ deviceKeyId: DEVICE_KEY_ID, ephemeralPublicKey: publicKey, wrappedKey: 'wrapped' }],
};

describe('createRouter', () => {
  const deviceKeys = {
    enroll: jest.fn(),
    listOwn: jest.fn(),
    revoke: jest.fn(),
    resolveRecipients: jest.fn(),
  };
  const pastes = {
    create: jest.fn(),
    uploadChunk: jest.fn(),
    finalize: jest.fn(),
    listSharedWithMe: jest.fn(),
    listMine: jest.fn(),
    read: jest.fn(),
    streamChunk: jest.fn(),
    listReads: jest.fn(),
    delete: jest.fn(),
  };
  let app: express.Express;

  beforeAll(async () => {
    // The router calls these methods only; the classes have no other public surface.
    const router = await createRouter({
      httpAuth: mockServices.httpAuth(),
      deviceKeys: deviceKeys as unknown as DeviceKeyService,
      pastes: pastes as unknown as PasteService,
      maxChunkBytes: MAX_CHUNK_BYTES,
    });
    app = express().use(router).use(mockErrorHandler());
  });

  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('POST /device-keys', () => {
    it('enrolls a key on behalf of the caller', async () => {
      deviceKeys.enroll.mockResolvedValue({ id: 'key-1', fingerprint: 'abc', label: 'Chrome', createdAt: 'now' });

      const response = await request(app).post('/device-keys').send({ publicKey, label: 'Chrome' });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ id: 'key-1', fingerprint: 'abc', label: 'Chrome', createdAt: 'now' });
      expect(deviceKeys.enroll).toHaveBeenCalledWith(
        { publicKey, label: 'Chrome' },
        { credentials: mockCredentials.user() },
      );
    });

    it('strips the JWK members that WebCrypto adds on export', async () => {
      deviceKeys.enroll.mockResolvedValue({});

      await request(app)
        .post('/device-keys')
        .send({ publicKey: { ...publicKey, ext: true, key_ops: [] }, label: 'Chrome' });

      expect(deviceKeys.enroll).toHaveBeenCalledWith({ publicKey, label: 'Chrome' }, expect.anything());
    });

    it.each([
      ['a curve other than P-256', { ...publicKey, crv: 'P-384' }],
      ['a key type other than EC', { ...publicKey, kty: 'RSA' }],
      ['a truncated coordinate', { ...publicKey, x: 'too-short' }],
      ['a coordinate that is not base64url', { ...publicKey, y: `${'a'.repeat(42)}+` }],
    ])('rejects %s', async (_name, invalidKey) => {
      const response = await request(app).post('/device-keys').send({ publicKey: invalidKey, label: 'Chrome' });

      expect(response.status).toBe(400);
      expect(deviceKeys.enroll).not.toHaveBeenCalled();
    });

    it.each([
      ['a missing label', { publicKey }],
      ['an empty label', { publicKey, label: '  ' }],
      ['an overlong label', { publicKey, label: 'l'.repeat(65) }],
      ['a missing key', { label: 'Chrome' }],
      ['an unexpected field', { publicKey, label: 'Chrome', fingerprint: 'claimed' }],
    ])('rejects %s', async (_name, body) => {
      const response = await request(app).post('/device-keys').send(body);

      expect(response.status).toBe(400);
      expect(deviceKeys.enroll).not.toHaveBeenCalled();
    });
  });

  describe('GET /device-keys', () => {
    it('lists the caller keys', async () => {
      deviceKeys.listOwn.mockResolvedValue([{ id: 'key-1' }]);

      const response = await request(app).get('/device-keys');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([{ id: 'key-1' }]);
    });
  });

  describe('DELETE /device-keys/:id', () => {
    it('revokes a key', async () => {
      deviceKeys.revoke.mockResolvedValue(undefined);

      const response = await request(app).delete(`/device-keys/${DEVICE_KEY_ID}`);

      expect(response.status).toBe(204);
      expect(deviceKeys.revoke).toHaveBeenCalledWith({ id: DEVICE_KEY_ID }, { credentials: mockCredentials.user() });
    });

    it('rejects an id that is not a uuid', async () => {
      const response = await request(app).delete('/device-keys/not-a-uuid');

      expect(response.status).toBe(400);
      expect(deviceKeys.revoke).not.toHaveBeenCalled();
    });
  });

  describe('POST /device-keys/resolve', () => {
    it('resolves recipients', async () => {
      deviceKeys.resolveRecipients.mockResolvedValue({ recipients: [], totalKeyCount: 0 });

      const response = await request(app)
        .post('/device-keys/resolve')
        .send({ entityRefs: ['group:default/platform'] });

      expect(response.status).toBe(200);
      expect(deviceKeys.resolveRecipients).toHaveBeenCalledWith(
        { entityRefs: ['group:default/platform'] },
        { credentials: mockCredentials.user() },
      );
    });

    it.each([
      ['an empty list', { entityRefs: [] }],
      ['a missing list', {}],
      ['more refs than allowed', { entityRefs: Array.from({ length: 201 }, (_, index) => `user:default/u${index}`) }],
      ['a non string ref', { entityRefs: [42] }],
    ])('rejects %s', async (_name, body) => {
      const response = await request(app).post('/device-keys/resolve').send(body);

      expect(response.status).toBe(400);
      expect(deviceKeys.resolveRecipients).not.toHaveBeenCalled();
    });
  });

  describe('POST /pastes', () => {
    it('creates a paste and returns its id', async () => {
      pastes.create.mockResolvedValue({ id: PASTE_ID });

      const response = await request(app).post('/pastes').send(createPasteBody);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({ id: PASTE_ID });
      expect(pastes.create).toHaveBeenCalledWith(createPasteBody, { credentials: mockCredentials.user() });
    });

    it.each([
      ['an unknown kind', { kind: 'video' }],
      ['a non ISO expiry', { expiresAt: 'tomorrow' }],
      ['a zero chunk count', { chunkCount: 0 }],
      ['a negative size', { sizeBytes: -1 }],
      ['a maxReads of zero', { maxReads: 0 }],
      ['a wrapped key without a device', { wrappedKeys: [{ ephemeralPublicKey: publicKey, wrappedKey: 'w' }] }],
      [
        'a wrapped key with a bad ephemeral key',
        {
          wrappedKeys: [
            { deviceKeyId: DEVICE_KEY_ID, ephemeralPublicKey: { ...publicKey, crv: 'P-384' }, wrappedKey: 'w' },
          ],
        },
      ],
      ['an unexpected field', { storageKey: 'chosen-by-client' }],
    ])('rejects %s', async (_name, override) => {
      const response = await request(app)
        .post('/pastes')
        .send({ ...createPasteBody, ...override });

      expect(response.status).toBe(400);
      expect(pastes.create).not.toHaveBeenCalled();
    });
  });

  describe('PUT /pastes/:id/chunks/:index', () => {
    it('forwards a raw ciphertext chunk', async () => {
      pastes.uploadChunk.mockResolvedValue(undefined);

      const response = await request(app)
        .put(`/pastes/${PASTE_ID}/chunks/2`)
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.from('ciphertext'));

      expect(response.status).toBe(204);
      expect(pastes.uploadChunk).toHaveBeenCalledWith(
        { pasteId: PASTE_ID, index: 2, data: Buffer.from('ciphertext') },
        { credentials: mockCredentials.user() },
      );
    });

    it('rejects a chunk larger than the configured maximum', async () => {
      const response = await request(app)
        .put(`/pastes/${PASTE_ID}/chunks/0`)
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.alloc(MAX_CHUNK_BYTES + 1));

      expect(response.status).toBe(413);
      expect(pastes.uploadChunk).not.toHaveBeenCalled();
    });

    it('rejects an empty body', async () => {
      const response = await request(app)
        .put(`/pastes/${PASTE_ID}/chunks/0`)
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.alloc(0));

      expect(response.status).toBe(400);
      expect(pastes.uploadChunk).not.toHaveBeenCalled();
    });

    it.each([
      ['a paste id of the wrong shape', `/pastes/short/chunks/0`],
      ['a negative chunk index', `/pastes/${PASTE_ID}/chunks/-1`],
      ['a non numeric chunk index', `/pastes/${PASTE_ID}/chunks/first`],
    ])('rejects %s', async (_name, path) => {
      const response = await request(app)
        .put(path)
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.from('x'));

      expect(response.status).toBe(400);
      expect(pastes.uploadChunk).not.toHaveBeenCalled();
    });
  });

  describe('POST /pastes/:id/finalize', () => {
    it('seals the paste', async () => {
      pastes.finalize.mockResolvedValue(undefined);

      const response = await request(app).post(`/pastes/${PASTE_ID}/finalize`);

      expect(response.status).toBe(204);
      expect(pastes.finalize).toHaveBeenCalledWith({ pasteId: PASTE_ID }, { credentials: mockCredentials.user() });
    });
  });

  describe('GET /pastes/shared-with-me', () => {
    it('lists the pastes one device can read', async () => {
      pastes.listSharedWithMe.mockResolvedValue([]);

      const response = await request(app).get('/pastes/shared-with-me').query({ deviceKeyId: DEVICE_KEY_ID, limit: 3 });

      expect(response.status).toBe(200);
      expect(pastes.listSharedWithMe).toHaveBeenCalledWith(
        { deviceKeyId: DEVICE_KEY_ID, limit: 3 },
        { credentials: mockCredentials.user() },
      );
    });

    it('is not mistaken for a paste id', async () => {
      pastes.listSharedWithMe.mockResolvedValue([]);

      await request(app).get('/pastes/shared-with-me').query({ deviceKeyId: DEVICE_KEY_ID });

      expect(pastes.read).not.toHaveBeenCalled();
      expect(pastes.listSharedWithMe).toHaveBeenCalledWith(
        { deviceKeyId: DEVICE_KEY_ID, limit: undefined },
        expect.anything(),
      );
    });

    it.each([
      ['a missing device key', {}],
      ['a device key that is not a uuid', { deviceKeyId: 'nope' }],
      ['a limit above the maximum', { deviceKeyId: DEVICE_KEY_ID, limit: 51 }],
      ['a zero limit', { deviceKeyId: DEVICE_KEY_ID, limit: 0 }],
    ])('rejects %s', async (_name, query) => {
      const response = await request(app).get('/pastes/shared-with-me').query(query);

      expect(response.status).toBe(400);
      expect(pastes.listSharedWithMe).not.toHaveBeenCalled();
    });
  });

  describe('GET /pastes/mine', () => {
    it('lists what the caller sent', async () => {
      pastes.listMine.mockResolvedValue([]);

      const response = await request(app).get('/pastes/mine');

      expect(response.status).toBe(200);
      expect(pastes.listMine).toHaveBeenCalledWith({ limit: 50 }, { credentials: mockCredentials.user() });
    });
  });

  describe('GET /pastes/:id', () => {
    it('reads a paste as a recipient', async () => {
      pastes.read.mockResolvedValue({ paste: { id: PASTE_ID }, wrappedKey: { deviceKeyId: DEVICE_KEY_ID } });

      const response = await request(app).get(`/pastes/${PASTE_ID}`).query({ deviceKeyId: DEVICE_KEY_ID });

      expect(response.status).toBe(200);
      expect(pastes.read).toHaveBeenCalledWith({
        pasteId: PASTE_ID,
        access: {
          via: 'recipient',
          userEntityRef: mockCredentials.user().principal.userEntityRef,
          deviceKeyId: DEVICE_KEY_ID,
        },
      });
    });

    it('requires a device key, since without one there is nothing to unwrap', async () => {
      const response = await request(app).get(`/pastes/${PASTE_ID}`);

      expect(response.status).toBe(400);
      expect(pastes.read).not.toHaveBeenCalled();
    });
  });

  describe('GET /pastes/:id/chunks/:index', () => {
    it('streams ciphertext as an opaque octet stream', async () => {
      pastes.streamChunk.mockResolvedValue(Readable.from([Buffer.from('ciphertext')]));

      const response = await request(app)
        .get(`/pastes/${PASTE_ID}/chunks/0`)
        .query({ deviceKeyId: DEVICE_KEY_ID })
        .buffer()
        .parse((res, callback) => {
          const chunks: Buffer[] = [];
          res.on('data', chunk => chunks.push(Buffer.from(chunk)));
          res.on('end', () => callback(null, Buffer.concat(chunks)));
        });

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('application/octet-stream');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.body).toEqual(Buffer.from('ciphertext'));
    });
  });

  describe('GET /pastes/:id/reads', () => {
    it('returns the read trail', async () => {
      pastes.listReads.mockResolvedValue([{ via: 'link', readAt: 'now' }]);

      const response = await request(app).get(`/pastes/${PASTE_ID}/reads`);

      expect(response.status).toBe(200);
      expect(pastes.listReads).toHaveBeenCalledWith({ pasteId: PASTE_ID }, { credentials: mockCredentials.user() });
    });
  });

  describe('DELETE /pastes/:id', () => {
    it('deletes a paste', async () => {
      pastes.delete.mockResolvedValue(undefined);

      const response = await request(app).delete(`/pastes/${PASTE_ID}`);

      expect(response.status).toBe(204);
      expect(pastes.delete).toHaveBeenCalledWith({ pasteId: PASTE_ID }, { credentials: mockCredentials.user() });
    });
  });

  describe('GET /link/:id', () => {
    it('reads a paste with a link token from the header', async () => {
      pastes.read.mockResolvedValue({ paste: { id: PASTE_ID } });

      const response = await request(app).get(`/link/${PASTE_ID}`).set('x-secure-share-link-token', 'token');

      expect(response.status).toBe(200);
      expect(pastes.read).toHaveBeenCalledWith({
        pasteId: PASTE_ID,
        access: { via: 'link', linkToken: 'token' },
      });
    });

    it('does not disclose whether the paste exists when the token is missing', async () => {
      const response = await request(app).get(`/link/${PASTE_ID}`);

      expect(response.status).toBe(404);
      expect(pastes.read).not.toHaveBeenCalled();
    });

    it('streams a chunk for a link reader', async () => {
      pastes.streamChunk.mockResolvedValue(Readable.from([Buffer.from('ciphertext')]));

      const response = await request(app).get(`/link/${PASTE_ID}/chunks/1`).set('x-secure-share-link-token', 'token');

      expect(response.status).toBe(200);
      expect(pastes.streamChunk).toHaveBeenCalledWith({
        pasteId: PASTE_ID,
        index: 1,
        access: { via: 'link', linkToken: 'token' },
      });
    });
  });
});
