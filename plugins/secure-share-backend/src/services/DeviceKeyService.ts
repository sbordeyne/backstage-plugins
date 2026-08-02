import { BackstageCredentials, BackstageUserPrincipal, LoggerService } from '@backstage/backend-plugin-api';
import { ConflictError, InputError, NotFoundError } from '@backstage/errors';
import {
  DeviceKey,
  DeviceKeySummary,
  EnrollDeviceKeyRequest,
  ResolvedRecipient,
  ResolveRecipientsRequest,
  ResolveRecipientsResponse,
} from '@sbordeyne/secure-share-common';
import { randomUUID } from 'crypto';
import { DeviceKeyStore, StoredDeviceKey } from '../database/DeviceKeyStore';
import { computeKeyFingerprint } from '../fingerprints';
import { RecipientResolver } from './RecipientResolver';

interface RequestOptions {
  credentials: BackstageCredentials<BackstageUserPrincipal>;
}

interface DeviceKeyServiceOptions {
  store: DeviceKeyStore;
  recipientResolver: RecipientResolver;
  logger: LoggerService;
  maxDeviceKeysPerUser: number;
  maxRecipientKeys: number;
}

/**
 * Manages the public keys that browsers enroll, and answers the question a sender
 * needs answered before creating a paste: which keys must this data key be wrapped for?
 *
 * @public
 */
export class DeviceKeyService {
  readonly #store: DeviceKeyStore;
  readonly #recipientResolver: RecipientResolver;
  readonly #logger: LoggerService;
  readonly #maxDeviceKeysPerUser: number;
  readonly #maxRecipientKeys: number;

  static create(options: DeviceKeyServiceOptions): DeviceKeyService {
    return new DeviceKeyService(options);
  }

  private constructor(options: DeviceKeyServiceOptions) {
    this.#store = options.store;
    this.#recipientResolver = options.recipientResolver;
    this.#logger = options.logger;
    this.#maxDeviceKeysPerUser = options.maxDeviceKeysPerUser;
    this.#maxRecipientKeys = options.maxRecipientKeys;
  }

  /**
   * Registers a browser's public key. Enrolling the same key twice is a no-op, so a
   * browser that lost track of its registration can safely retry.
   */
  async enroll(request: EnrollDeviceKeyRequest, options: RequestOptions): Promise<DeviceKeySummary> {
    const userEntityRef = options.credentials.principal.userEntityRef;
    const fingerprint = computeKeyFingerprint(request.publicKey);

    const existing = await this.#store.findActiveByFingerprint({ userEntityRef, fingerprint });
    if (existing) {
      return toSummary(existing);
    }
    await this.#assertRoomForAnotherKey(userEntityRef);

    const deviceKey: StoredDeviceKey = {
      id: randomUUID(),
      userEntityRef,
      publicKey: request.publicKey,
      fingerprint,
      label: request.label,
      createdAt: new Date().toISOString(),
    };
    await this.#store.insert({ ...deviceKey, createdAt: new Date(deviceKey.createdAt) });
    this.#logger.info(`Enrolled device key ${fingerprint} for '${userEntityRef}'`);
    return toSummary(deviceKey);
  }

  async listOwn(options: RequestOptions): Promise<DeviceKeySummary[]> {
    const keys = await this.#store.listActiveByUser(options.credentials.principal.userEntityRef);
    return keys.map(toSummary);
  }

  /**
   * Revokes one of the caller's own keys. Pastes already wrapped for it stay
   * unreadable rather than being re-wrapped: only the sender ever held the data key.
   */
  async revoke(input: { id: string }, options: RequestOptions): Promise<void> {
    const userEntityRef = options.credentials.principal.userEntityRef;
    const revoked = await this.#store.revoke({ id: input.id, userEntityRef, revokedAt: new Date() });
    if (!revoked) {
      throw new NotFoundError(`No active device key '${input.id}' found for the current user`);
    }
    this.#logger.info(`Revoked device key '${input.id}' for '${userEntityRef}'`);
  }

  async resolveRecipients(
    request: ResolveRecipientsRequest,
    options: RequestOptions,
  ): Promise<ResolveRecipientsResponse> {
    const resolved = await this.#recipientResolver.resolve({ entityRefs: request.entityRefs }, options);
    const keysByUser = await this.#loadKeysByUser(resolved.users.map(user => user.entityRef));

    const recipients: ResolvedRecipient[] = [];
    const userEntityRefsWithoutKeys: string[] = [];
    for (const user of resolved.users) {
      const keys = keysByUser.get(user.entityRef) ?? [];
      if (keys.length === 0) {
        userEntityRefsWithoutKeys.push(user.entityRef);
        continue;
      }
      recipients.push({
        userEntityRef: user.entityRef,
        displayName: user.displayName,
        viaEntityRefs: user.viaEntityRefs,
        keys,
      });
    }

    const totalKeyCount = recipients.reduce((total, recipient) => total + recipient.keys.length, 0);
    this.#assertRecipientKeyCount(totalKeyCount);
    return {
      recipients,
      unresolvedEntityRefs: resolved.unresolvedEntityRefs,
      userEntityRefsWithoutKeys,
      totalKeyCount,
    };
  }

  async #loadKeysByUser(userEntityRefs: string[]): Promise<Map<string, DeviceKey[]>> {
    const keys = await this.#store.listActiveByUsers(userEntityRefs);
    const keysByUser = new Map<string, DeviceKey[]>();
    for (const key of keys) {
      const userKeys = keysByUser.get(key.userEntityRef) ?? [];
      userKeys.push(toDeviceKey(key));
      keysByUser.set(key.userEntityRef, userKeys);
    }
    return keysByUser;
  }

  async #assertRoomForAnotherKey(userEntityRef: string): Promise<void> {
    const activeKeyCount = await this.#store.countActiveByUser(userEntityRef);
    if (activeKeyCount >= this.#maxDeviceKeysPerUser) {
      throw new ConflictError(
        `You already have ${activeKeyCount} enrolled devices, which is the configured maximum. ` +
          'Revoke one before enrolling another.',
      );
    }
  }

  #assertRecipientKeyCount(totalKeyCount: number): void {
    if (totalKeyCount > this.#maxRecipientKeys) {
      throw new InputError(
        `This audience needs ${totalKeyCount} recipient keys, more than the configured maximum of ` +
          `${this.#maxRecipientKeys}. Share with fewer users or groups.`,
      );
    }
  }
}

function toDeviceKey(key: StoredDeviceKey): DeviceKey {
  const { userEntityRef, ...deviceKey } = key;
  return deviceKey;
}

function toSummary(key: StoredDeviceKey): DeviceKeySummary {
  const { publicKey, userEntityRef, ...summary } = key;
  return summary;
}
