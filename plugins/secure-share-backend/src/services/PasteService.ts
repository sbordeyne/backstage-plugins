import { BackstageCredentials, BackstageUserPrincipal, LoggerService } from '@backstage/backend-plugin-api';
import { InputError, NotFoundError } from '@backstage/errors';
import {
  CreatePasteRequest,
  CreatePasteResponse,
  PasteReadEntry,
  PasteReadResponse,
  PasteSummary,
  SecureShareSharedConfig,
  SharedPaste,
  WrappedKey,
} from '@sbordeyne/secure-share-common';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { Readable } from 'stream';
import { DeviceKeyStore } from '../database/DeviceKeyStore';
import { PasteRecord, PasteStore } from '../database/PasteStore';
import { normalizeRecipientRefs } from '../recipientRefs';
import { BlobStore } from '../storage';
import { assertValidCreateRequest, CHUNK_CRYPTO_OVERHEAD_BYTES } from './pasteValidation';

const PASTE_ID_BYTES = 16;
const LINK_TOKEN_BYTES = 32;

/**
 * Returned whenever a paste is missing, expired, burned, or simply not shared with the
 * caller. One message for all of those cases, so that the API cannot be used to probe
 * which paste ids exist.
 */
const NOT_AVAILABLE = 'Paste not found or no longer available';

interface RequestOptions {
  credentials: BackstageCredentials<BackstageUserPrincipal>;
}

/** How a reader proved they may read a paste. */
export type PasteAccess =
  | { via: 'recipient'; userEntityRef: string; deviceKeyId: string }
  | { via: 'link'; linkToken: string };

interface PasteServiceOptions {
  pastes: PasteStore;
  deviceKeys: DeviceKeyStore;
  blobStore: BlobStore;
  config: SecureShareSharedConfig;
  burnGracePeriodMs: number;
  logger: LoggerService;
}

/**
 * Creates, serves and deletes pastes.
 *
 * Everything this service handles is already encrypted: it validates limits, decides who
 * may fetch which ciphertext, and counts reads. It cannot decrypt anything it stores.
 *
 * @public
 */
export class PasteService {
  readonly #pastes: PasteStore;
  readonly #deviceKeys: DeviceKeyStore;
  readonly #blobStore: BlobStore;
  readonly #config: SecureShareSharedConfig;
  readonly #burnGracePeriodMs: number;
  readonly #logger: LoggerService;

  static create(options: PasteServiceOptions): PasteService {
    return new PasteService(options);
  }

  private constructor(options: PasteServiceOptions) {
    this.#pastes = options.pastes;
    this.#deviceKeys = options.deviceKeys;
    this.#blobStore = options.blobStore;
    this.#config = options.config;
    this.#burnGracePeriodMs = options.burnGracePeriodMs;
    this.#logger = options.logger;
  }

  /**
   * Registers a paste and the wrapped keys that make it readable. The ciphertext is
   * uploaded afterwards, chunk by chunk, and the paste stays unreadable until finalized.
   */
  async create(request: CreatePasteRequest, options: RequestOptions): Promise<CreatePasteResponse> {
    const now = new Date();
    assertValidCreateRequest({ request, config: this.#config, now });

    const createdByEntityRef = options.credentials.principal.userEntityRef;
    const wrappedKeys = await this.#attachKeyOwners(request.wrappedKeys);
    const linkToken = request.linkEnabled ? randomBytes(LINK_TOKEN_BYTES).toString('base64url') : undefined;
    const id = randomBytes(PASTE_ID_BYTES).toString('base64url');

    await this.#pastes.insert({
      id,
      createdByEntityRef,
      kind: request.kind,
      metaCiphertext: request.metaCiphertext,
      chunkCount: request.chunkCount,
      sizeBytes: request.sizeBytes,
      storageKey: randomUUID(),
      expiresAt: new Date(request.expiresAt),
      burnAfterRead: request.burnAfterRead,
      maxReads: request.maxReads,
      linkTokenHash: linkToken && hashLinkToken(linkToken),
      createdAt: now,
      recipientEntityRefs: normalizeRecipientRefs(request.recipientEntityRefs),
      wrappedKeys,
    });

    this.#logger.info(
      `Created paste ${id} for ${wrappedKeys.length} recipient devices, expiring at ${request.expiresAt}`,
    );
    return { id, linkToken };
  }

  async uploadChunk(input: { pasteId: string; index: number; data: Buffer }, options: RequestOptions): Promise<void> {
    const paste = await this.#mustGetOwnPaste(input.pasteId, options);
    if (paste.finalizedAt) {
      throw new InputError('This paste has already been finalized and cannot be changed');
    }
    this.#assertValidChunkUpload({ paste, index: input.index, size: input.data.length });

    await this.#blobStore.writeChunk({ storageKey: paste.storageKey, index: input.index, data: input.data });
    await this.#pastes.recordChunk({
      pasteId: paste.id,
      index: input.index,
      sizeBytes: input.data.length,
      at: new Date(),
    });
  }

  /**
   * Seals a paste once every chunk is present. Reads are refused before this point, so
   * a recipient never sees a half uploaded payload.
   */
  async finalize(input: { pasteId: string }, options: RequestOptions): Promise<void> {
    const paste = await this.#mustGetOwnPaste(input.pasteId, options);
    if (paste.finalizedAt) {
      return;
    }
    await this.#assertPayloadComplete(paste);
    await this.#pastes.markFinalized({ id: paste.id, at: new Date() });
  }

  async listSharedWithMe(
    input: { deviceKeyId: string; limit?: number },
    options: RequestOptions,
  ): Promise<SharedPaste[]> {
    const userEntityRef = options.credentials.principal.userEntityRef;
    await this.#assertOwnDevice(input.deviceKeyId, userEntityRef);
    const now = new Date();

    const readable = await this.#pastes.listReadableByDevice({
      userEntityRef,
      deviceKeyId: input.deviceKeyId,
      limit: input.limit ?? this.#config.card.limit,
      now,
    });
    const available = readable.filter(entry => this.#isAvailable(entry.paste, now));
    const recipientRefs = await this.#pastes.listRecipientRefs(available.map(entry => entry.paste.id));

    await this.#deviceKeys.markUsed({ id: input.deviceKeyId, at: now });
    return available.map(entry => ({
      ...toPasteSummary(entry.paste, recipientRefs.get(entry.paste.id) ?? []),
      wrappedKey: entry.wrappedKey,
    }));
  }

  async listMine(input: { limit: number }, options: RequestOptions): Promise<PasteSummary[]> {
    const pastes = await this.#pastes.listCreatedBy({
      userEntityRef: options.credentials.principal.userEntityRef,
      limit: input.limit,
      now: new Date(),
    });
    const recipientRefs = await this.#pastes.listRecipientRefs(pastes.map(paste => paste.id));
    return pastes.map(paste => toPasteSummary(paste, recipientRefs.get(paste.id) ?? []));
  }

  /**
   * Returns a paste's metadata and, for a recipient, the wrapped key their device needs.
   * A link reader gets no wrapped key: their key is in the URL fragment.
   */
  async read(input: { pasteId: string; access: PasteAccess }): Promise<PasteReadResponse> {
    const paste = await this.#mustGetAvailablePaste(input.pasteId);
    const wrappedKey = await this.#authorize({ paste, access: input.access });
    const recipientRefs = await this.#pastes.listRecipientRefs([paste.id]);
    return { paste: toPasteSummary(paste, recipientRefs.get(paste.id) ?? []), wrappedKey };
  }

  /**
   * Streams one ciphertext chunk. Fetching the first chunk is what counts as a read: it
   * is the point at which the payload leaves the backend.
   */
  async streamChunk(input: { pasteId: string; index: number; access: PasteAccess }): Promise<Readable> {
    const paste = await this.#mustGetAvailablePaste(input.pasteId);
    await this.#authorize({ paste, access: input.access });
    if (!Number.isInteger(input.index) || input.index < 0 || input.index >= paste.chunkCount) {
      throw new NotFoundError(`Paste '${paste.id}' has no chunk ${input.index}`);
    }

    const stream = await this.#blobStore.readChunk({ storageKey: paste.storageKey, index: input.index });
    if (input.index === 0) {
      await this.#countRead(paste, input.access);
    }
    return stream;
  }

  /** Lists who opened a paste. Only the sender can see this. */
  async listReads(input: { pasteId: string }, options: RequestOptions): Promise<PasteReadEntry[]> {
    await this.#mustGetOwnPaste(input.pasteId, options);
    return await this.#pastes.listReads(input.pasteId);
  }

  async delete(input: { pasteId: string }, options: RequestOptions): Promise<void> {
    const paste = await this.#mustGetOwnPaste(input.pasteId, options);
    await this.#blobStore.deleteAll({ storageKey: paste.storageKey });
    await this.#pastes.delete(paste.id);
    this.#logger.info(`Deleted paste ${paste.id} at the request of its sender`);
  }

  async #countRead(paste: PasteRecord, access: PasteAccess): Promise<void> {
    const now = new Date();
    await this.#pastes.incrementReadCount(paste.id);
    await this.#pastes.recordRead({
      pasteId: paste.id,
      readerEntityRef: access.via === 'recipient' ? access.userEntityRef : undefined,
      deviceKeyId: access.via === 'recipient' ? access.deviceKeyId : undefined,
      via: access.via,
      at: now,
    });
    if (paste.burnAfterRead) {
      await this.#pastes.markConsumed({ id: paste.id, at: now });
    }
  }

  /**
   * Checks that the reader may see this paste, and returns the wrapped key they need.
   * For a recipient, holding a wrapped key for one of their own devices *is* the
   * authorization: without it there is nothing they could decrypt anyway.
   */
  async #authorize(input: { paste: PasteRecord; access: PasteAccess }): Promise<WrappedKey | undefined> {
    if (input.access.via === 'link') {
      await this.#assertValidLinkToken(input.paste, input.access.linkToken);
      return undefined;
    }
    await this.#assertOwnDevice(input.access.deviceKeyId, input.access.userEntityRef);
    const wrappedKey = await this.#pastes.findWrappedKey({
      pasteId: input.paste.id,
      deviceKeyId: input.access.deviceKeyId,
    });
    if (!wrappedKey) {
      throw new NotFoundError(NOT_AVAILABLE);
    }
    return wrappedKey;
  }

  async #assertValidLinkToken(paste: PasteRecord, linkToken: string): Promise<void> {
    const expectedHash = paste.linkEnabled ? await this.#pastes.getLinkTokenHash(paste.id) : undefined;
    if (!expectedHash || !matchesLinkToken(linkToken, expectedHash)) {
      throw new NotFoundError(NOT_AVAILABLE);
    }
  }

  async #assertOwnDevice(deviceKeyId: string, userEntityRef: string): Promise<void> {
    const deviceKey = await this.#deviceKeys.findActiveById(deviceKeyId);
    if (!deviceKey || deviceKey.userEntityRef !== userEntityRef) {
      throw new NotFoundError(`No active device key '${deviceKeyId}' found for the current user`);
    }
  }

  async #attachKeyOwners(wrappedKeys: WrappedKey[]): Promise<Array<WrappedKey & { userEntityRef: string }>> {
    const owned: Array<WrappedKey & { userEntityRef: string }> = [];
    for (const wrappedKey of wrappedKeys) {
      const deviceKey = await this.#deviceKeys.findActiveById(wrappedKey.deviceKeyId);
      if (!deviceKey) {
        throw new InputError(`Device key '${wrappedKey.deviceKeyId}' does not exist or has been revoked`);
      }
      // The owner is denormalized so listing a user's readable pastes stays one indexed join.
      owned.push({ ...wrappedKey, userEntityRef: deviceKey.userEntityRef });
    }
    return owned;
  }

  async #mustGetOwnPaste(pasteId: string, options: RequestOptions): Promise<PasteRecord> {
    const paste = await this.#pastes.getById(pasteId);
    if (!paste || paste.createdByEntityRef !== options.credentials.principal.userEntityRef) {
      throw new NotFoundError(NOT_AVAILABLE);
    }
    return paste;
  }

  async #mustGetAvailablePaste(pasteId: string): Promise<PasteRecord> {
    const paste = await this.#pastes.getById(pasteId);
    if (!paste || !this.#isAvailable(paste, new Date())) {
      throw new NotFoundError(NOT_AVAILABLE);
    }
    return paste;
  }

  /**
   * A paste is readable while it is sealed, unexpired, under its read cap, and — when it
   * burns after reading — still inside the grace period that lets an interrupted
   * download be retried.
   */
  #isAvailable(paste: PasteRecord, now: Date): boolean {
    if (!paste.finalizedAt || new Date(paste.expiresAt) <= now) {
      return false;
    }
    if (paste.maxReads !== undefined && paste.readCount >= paste.maxReads) {
      return false;
    }
    if (paste.burnAfterRead && paste.consumedAt) {
      return new Date(paste.consumedAt).getTime() + this.#burnGracePeriodMs > now.getTime();
    }
    return true;
  }

  #assertValidChunkUpload(input: { paste: PasteRecord; index: number; size: number }): void {
    if (!Number.isInteger(input.index) || input.index < 0 || input.index >= input.paste.chunkCount) {
      throw new InputError(`Chunk index ${input.index} is outside the declared ${input.paste.chunkCount} chunks`);
    }
    const maxChunkBytes = this.#config.limits.chunkSizeBytes + CHUNK_CRYPTO_OVERHEAD_BYTES;
    if (input.size < 1 || input.size > maxChunkBytes) {
      throw new InputError(`A chunk must be between 1 and ${maxChunkBytes} bytes, got ${input.size}`);
    }
  }

  async #assertPayloadComplete(paste: PasteRecord): Promise<void> {
    const uploadedChunks = await this.#pastes.countChunks(paste.id);
    if (uploadedChunks !== paste.chunkCount) {
      throw new InputError(`Expected ${paste.chunkCount} chunks before finalizing, found ${uploadedChunks}`);
    }
    const uploadedBytes = await this.#pastes.sumChunkSizes(paste.id);
    if (uploadedBytes !== paste.sizeBytes) {
      throw new InputError(`Declared ${paste.sizeBytes} ciphertext bytes but uploaded ${uploadedBytes}`);
    }
  }
}

function toPasteSummary(paste: PasteRecord, recipientEntityRefs: string[]): PasteSummary {
  return {
    id: paste.id,
    kind: paste.kind,
    createdByEntityRef: paste.createdByEntityRef,
    metaCiphertext: paste.metaCiphertext,
    chunkCount: paste.chunkCount,
    sizeBytes: paste.sizeBytes,
    createdAt: paste.createdAt,
    expiresAt: paste.expiresAt,
    burnAfterRead: paste.burnAfterRead,
    maxReads: paste.maxReads,
    readCount: paste.readCount,
    linkEnabled: paste.linkEnabled,
    recipientEntityRefs,
  };
}

function hashLinkToken(linkToken: string): string {
  return createHash('sha256').update(linkToken).digest('base64');
}

/** Compared through a constant time digest comparison, so a token cannot be guessed byte by byte. */
function matchesLinkToken(linkToken: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashLinkToken(linkToken), 'base64');
  const expected = Buffer.from(expectedHash, 'base64');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
