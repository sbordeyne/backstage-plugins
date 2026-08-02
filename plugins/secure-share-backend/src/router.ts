import { HttpAuthService } from '@backstage/backend-plugin-api';
import { InputError, NotFoundError } from '@backstage/errors';
import express from 'express';
import Router from 'express-promise-router';
import { z } from 'zod';
import { DeviceKeyService } from './services/DeviceKeyService';
import { PasteAccess, PasteService } from './services/PasteService';

const METADATA_BODY_LIMIT = '1mb';
const LINK_TOKEN_HEADER = 'x-secure-share-link-token';
const MAX_LIST_LIMIT = 50;

/** A P-256 coordinate is 32 bytes, which is 43 unpadded base64url characters. */
const COORDINATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Unknown JWK members are stripped rather than rejected: WebCrypto adds `ext` and
 * `key_ops` on export, and only the four thumbprint members are ever stored.
 */
const ecdhPublicKeySchema = z.object({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  x: z.string().regex(COORDINATE_PATTERN, 'must be a base64url encoded P-256 coordinate'),
  y: z.string().regex(COORDINATE_PATTERN, 'must be a base64url encoded P-256 coordinate'),
});

const enrollDeviceKeySchema = z
  .object({
    publicKey: ecdhPublicKeySchema,
    label: z.string().trim().min(1).max(64),
  })
  .strict();

const resolveRecipientsSchema = z
  .object({
    entityRefs: z.array(z.string().min(1)).min(1).max(200),
  })
  .strict();

const wrappedKeySchema = z
  .object({
    deviceKeyId: z.string().uuid(),
    ephemeralPublicKey: ecdhPublicKeySchema,
    wrappedKey: z.string().min(1).max(1024),
  })
  .strict();

const createPasteSchema = z
  .object({
    kind: z.enum(['text', 'file']),
    metaCiphertext: z.string().min(1).max(8192),
    chunkCount: z.number().int().min(1),
    sizeBytes: z.number().int().min(1),
    expiresAt: z.string().datetime(),
    burnAfterRead: z.boolean(),
    maxReads: z.number().int().min(1).optional(),
    linkEnabled: z.boolean(),
    recipientEntityRefs: z.array(z.string().min(1)).max(200),
    wrappedKeys: z.array(wrappedKeySchema),
  })
  .strict();

const deviceKeyIdSchema = z.string().uuid();
const pasteIdSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/, 'must be a paste id');
const chunkIndexSchema = z.coerce.number().int().min(0);
const listLimitSchema = z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).optional();

export async function createRouter({
  httpAuth,
  deviceKeys,
  pastes,
  maxChunkBytes,
}: {
  httpAuth: HttpAuthService;
  deviceKeys: DeviceKeyService;
  pastes: PasteService;
  maxChunkBytes: number;
}): Promise<express.Router> {
  const router = Router();
  router.use(express.json({ limit: METADATA_BODY_LIMIT }));

  const chunkBody = express.raw({ type: 'application/octet-stream', limit: maxChunkBytes });

  router.post('/device-keys', async (req, res) => {
    const request = parse(enrollDeviceKeySchema, req.body);
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    res.status(201).json(await deviceKeys.enroll(request, { credentials }));
  });

  router.get('/device-keys', async (req, res) => {
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    res.json(await deviceKeys.listOwn({ credentials }));
  });

  router.delete('/device-keys/:id', async (req, res) => {
    const id = parse(deviceKeyIdSchema, req.params.id);
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    await deviceKeys.revoke({ id }, { credentials });
    res.status(204).end();
  });

  router.post('/device-keys/resolve', async (req, res) => {
    const request = parse(resolveRecipientsSchema, req.body);
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    res.json(await deviceKeys.resolveRecipients(request, { credentials }));
  });

  router.post('/pastes', async (req, res) => {
    const request = parse(createPasteSchema, req.body);
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    res.status(201).json(await pastes.create(request, { credentials }));
  });

  // Declared before /pastes/:id so that the fixed segments are not read as paste ids.
  router.get('/pastes/shared-with-me', async (req, res) => {
    const deviceKeyId = parse(deviceKeyIdSchema, req.query.deviceKeyId);
    const limit = parse(listLimitSchema, req.query.limit);
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    res.json(await pastes.listSharedWithMe({ deviceKeyId, limit }, { credentials }));
  });

  router.get('/pastes/mine', async (req, res) => {
    const limit = parse(listLimitSchema, req.query.limit) ?? MAX_LIST_LIMIT;
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    res.json(await pastes.listMine({ limit }, { credentials }));
  });

  router.put('/pastes/:id/chunks/:index', chunkBody, async (req, res) => {
    const pasteId = parse(pasteIdSchema, req.params.id);
    const index = parse(chunkIndexSchema, req.params.index);
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    await pastes.uploadChunk({ pasteId, index, data: asChunk(req.body) }, { credentials });
    res.status(204).end();
  });

  router.post('/pastes/:id/finalize', async (req, res) => {
    const pasteId = parse(pasteIdSchema, req.params.id);
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    await pastes.finalize({ pasteId }, { credentials });
    res.status(204).end();
  });

  router.get('/pastes/:id/reads', async (req, res) => {
    const pasteId = parse(pasteIdSchema, req.params.id);
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    res.json(await pastes.listReads({ pasteId }, { credentials }));
  });

  router.get('/pastes/:id/chunks/:index', async (req, res) => {
    const pasteId = parse(pasteIdSchema, req.params.id);
    const index = parse(chunkIndexSchema, req.params.index);
    const access = await recipientAccess(req);
    await streamChunk(res, await pastes.streamChunk({ pasteId, index, access }));
  });

  router.get('/pastes/:id', async (req, res) => {
    const pasteId = parse(pasteIdSchema, req.params.id);
    const access = await recipientAccess(req);
    res.json(await pastes.read({ pasteId, access }));
  });

  router.delete('/pastes/:id', async (req, res) => {
    const pasteId = parse(pasteIdSchema, req.params.id);
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    await pastes.delete({ pasteId }, { credentials });
    res.status(204).end();
  });

  // Secret link reads live under their own prefix so that only this prefix has to be
  // opened to unauthenticated callers. The data key stays in the URL fragment and never
  // reaches the backend; the token below only authorizes fetching the ciphertext, and
  // travels in a header to keep it out of access logs.
  router.get('/link/:id/chunks/:index', async (req, res) => {
    const pasteId = parse(pasteIdSchema, req.params.id);
    const index = parse(chunkIndexSchema, req.params.index);
    await streamChunk(res, await pastes.streamChunk({ pasteId, index, access: linkAccess(req) }));
  });

  router.get('/link/:id', async (req, res) => {
    const pasteId = parse(pasteIdSchema, req.params.id);
    res.json(await pastes.read({ pasteId, access: linkAccess(req) }));
  });

  async function recipientAccess(req: express.Request): Promise<PasteAccess> {
    const deviceKeyId = parse(deviceKeyIdSchema, req.query.deviceKeyId);
    const credentials = await httpAuth.credentials(req, { allow: ['user'] });
    return { via: 'recipient', userEntityRef: credentials.principal.userEntityRef, deviceKeyId };
  }

  return router;
}

function linkAccess(req: express.Request): PasteAccess {
  const linkToken = req.header(LINK_TOKEN_HEADER);
  if (!linkToken) {
    throw new NotFoundError('Paste not found or no longer available');
  }
  return { via: 'link', linkToken };
}

async function streamChunk(res: express.Response, chunk: NodeJS.ReadableStream): Promise<void> {
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  await new Promise<void>((resolve, reject) => {
    chunk.on('error', reject);
    res.on('finish', resolve);
    chunk.pipe(res);
  });
}

function asChunk(body: unknown): Buffer {
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new InputError('A chunk must be sent as a non empty application/octet-stream body');
  }
  return body;
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    const details = result.error.issues.map(issue => `${issue.path.join('.') || 'body'} ${issue.message}`).join('; ');
    throw new InputError(`Invalid request: ${details}`);
  }
  return result.data;
}
