import { InputError } from '@backstage/errors';
import { CreatePasteRequest, PasteKind, SecureShareSharedConfig } from '@sbordeyne/secure-share-common';

/**
 * AES-GCM adds a 12 byte iv and a 16 byte authentication tag to every chunk, so the
 * ciphertext a client uploads is legitimately larger than the configured plaintext limit.
 */
export const CHUNK_CRYPTO_OVERHEAD_BYTES = 28;

/** Tolerance for clock differences between the browser and the backend. */
const EXPIRY_SKEW_MS = 60_000;

/**
 * The largest ciphertext the configuration allows for a paste of this kind.
 *
 * @public
 */
export function maxCiphertextBytes(options: {
  kind: PasteKind;
  chunkCount: number;
  limits: SecureShareSharedConfig['limits'];
}): number {
  const plaintextLimit = options.kind === 'text' ? options.limits.maxTextSizeBytes : options.limits.maxFileSizeBytes;
  return plaintextLimit + options.chunkCount * CHUNK_CRYPTO_OVERHEAD_BYTES;
}

/**
 * Rejects a create request that breaks a configured limit.
 *
 * The browser checks the same limits for immediate feedback, which is a convenience,
 * not a control: everything here is enforced again because the request is client input.
 *
 * @public
 */
export function assertValidCreateRequest(options: {
  request: CreatePasteRequest;
  config: SecureShareSharedConfig;
  now: Date;
}): void {
  const { request, config, now } = options;
  assertValidExpiry({ expiresAt: request.expiresAt, maxMs: config.expiration.maxMs, now });
  assertValidChunking(request, config);
  assertValidSize(request, config);
  assertValidAudience(request, config);
  assertValidMaxReads(request);
}

function assertValidExpiry(options: { expiresAt: string; maxMs: number; now: Date }): void {
  const expiresAt = new Date(options.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) {
    throw new InputError(`Invalid expiry '${options.expiresAt}'`);
  }
  if (expiresAt.getTime() <= options.now.getTime()) {
    throw new InputError('A paste must expire in the future');
  }
  if (expiresAt.getTime() > options.now.getTime() + options.maxMs + EXPIRY_SKEW_MS) {
    throw new InputError('The requested expiry is longer than secureShare.expiration.max allows');
  }
}

function assertValidChunking(request: CreatePasteRequest, config: SecureShareSharedConfig): void {
  if (!Number.isInteger(request.chunkCount) || request.chunkCount < 1) {
    throw new InputError('A paste must declare at least one chunk');
  }
  const plaintextLimit = request.kind === 'text' ? config.limits.maxTextSizeBytes : config.limits.maxFileSizeBytes;
  const maxChunks = Math.ceil(plaintextLimit / config.limits.chunkSizeBytes) + 1;
  if (request.chunkCount > maxChunks) {
    throw new InputError(`A ${request.kind} paste may not have more than ${maxChunks} chunks`);
  }
}

function assertValidSize(request: CreatePasteRequest, config: SecureShareSharedConfig): void {
  if (!Number.isInteger(request.sizeBytes) || request.sizeBytes < 1) {
    throw new InputError('A paste must declare a positive ciphertext size');
  }
  const maxBytes = maxCiphertextBytes({
    kind: request.kind,
    chunkCount: request.chunkCount,
    limits: config.limits,
  });
  if (request.sizeBytes > maxBytes) {
    throw new InputError(`A ${request.kind} paste may not exceed ${maxBytes} ciphertext bytes`);
  }
}

function assertValidAudience(request: CreatePasteRequest, config: SecureShareSharedConfig): void {
  if (request.wrappedKeys.length === 0 && !request.linkEnabled) {
    throw new InputError(
      'A paste needs at least one recipient device or a secret link, otherwise nobody could read it',
    );
  }
  if (request.wrappedKeys.length > config.limits.maxRecipientKeys) {
    throw new InputError(
      `A paste may be wrapped for at most ${config.limits.maxRecipientKeys} recipient devices, got ${request.wrappedKeys.length}`,
    );
  }
  const deviceKeyIds = new Set(request.wrappedKeys.map(wrappedKey => wrappedKey.deviceKeyId));
  if (deviceKeyIds.size !== request.wrappedKeys.length) {
    throw new InputError('A paste must not carry two wrapped keys for the same device');
  }
}

function assertValidMaxReads(request: CreatePasteRequest): void {
  if (request.maxReads === undefined) {
    return;
  }
  if (!Number.isInteger(request.maxReads) || request.maxReads < 1) {
    throw new InputError('maxReads must be a positive integer when set');
  }
}
