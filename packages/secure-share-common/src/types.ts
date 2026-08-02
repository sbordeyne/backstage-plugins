/**
 * A P-256 ECDH public key in JWK form, as exported by WebCrypto.
 *
 * Only public coordinates are ever transmitted: the matching private key stays in
 * the browser that generated it, as a non-extractable key in IndexedDB.
 *
 * @public
 */
export interface EcdhPublicKeyJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
}

/**
 * A public key enrolled by one browser of one user.
 *
 * @public
 */
export interface DeviceKey {
  id: string;
  publicKey: EcdhPublicKeyJwk;
  fingerprint: string;
  label: string;
  createdAt: string;
  lastUsedAt?: string;
}

/**
 * A device key as shown to its owner, without the key material.
 *
 * @public
 */
export type DeviceKeySummary = Omit<DeviceKey, 'publicKey'>;

/**
 * Request body of `POST /device-keys`.
 *
 * @public
 */
export interface EnrollDeviceKeyRequest {
  publicKey: EcdhPublicKeyJwk;
  label: string;
}

/**
 * Request body of `POST /device-keys/resolve`.
 *
 * @public
 */
export interface ResolveRecipientsRequest {
  /** Catalog refs of the intended recipients: `user:` and/or `group:` kinds. */
  entityRefs: string[];
}

/**
 * The device keys of a single user that a paste must be wrapped for.
 *
 * @public
 */
export interface ResolvedRecipient {
  userEntityRef: string;
  displayName?: string;
  /** The requested refs that resolved to this user, e.g. the groups they belong to. */
  viaEntityRefs: string[];
  keys: DeviceKey[];
}

/**
 * Response body of `POST /device-keys/resolve`.
 *
 * A sender needs this to wrap the paste data key once per recipient device. Users
 * listed in `userEntityRefsWithoutKeys` have never enrolled a browser and therefore
 * cannot be given access; the UI is expected to say so before the paste is created.
 *
 * @public
 */
export interface ResolveRecipientsResponse {
  recipients: ResolvedRecipient[];
  unresolvedEntityRefs: string[];
  userEntityRefsWithoutKeys: string[];
  totalKeyCount: number;
}

/**
 * Whether a paste holds text typed into the form or an uploaded file.
 *
 * @public
 */
export type PasteKind = 'text' | 'file';

/**
 * A paste data key, wrapped so that exactly one device can unwrap it.
 *
 * The sender derives a shared secret from a throwaway key pair and the recipient
 * device's public key, so the wrapping key exists only in those two browsers.
 *
 * @public
 */
export interface WrappedKey {
  deviceKeyId: string;
  ephemeralPublicKey: EcdhPublicKeyJwk;
  /** Base64 encoded AES-GCM iv followed by the wrapped data key. */
  wrappedKey: string;
}

/**
 * Request body of `POST /pastes`, sent before the ciphertext chunks are uploaded.
 *
 * @public
 */
export interface CreatePasteRequest {
  kind: PasteKind;
  /** Base64 encoded iv and ciphertext of the sealed title, filename and mime type. */
  metaCiphertext: string;
  chunkCount: number;
  /** Total size of the ciphertext chunks, used to enforce the configured limits. */
  sizeBytes: number;
  expiresAt: string;
  burnAfterRead: boolean;
  maxReads?: number;
  /** Whether to mint a secret link, whose key never leaves the URL fragment. */
  linkEnabled: boolean;
  /** The user and group refs the sender picked, kept for display only. */
  recipientEntityRefs: string[];
  wrappedKeys: WrappedKey[];
}

/**
 * Response body of `POST /pastes`. The link token is returned once and never again.
 *
 * @public
 */
export interface CreatePasteResponse {
  id: string;
  linkToken?: string;
}

/**
 * Everything about a paste that the backend is able to disclose. The title and
 * filename are inside `metaCiphertext` and only a holder of the data key can read them.
 *
 * @public
 */
export interface PasteSummary {
  id: string;
  kind: PasteKind;
  createdByEntityRef: string;
  metaCiphertext: string;
  chunkCount: number;
  sizeBytes: number;
  createdAt: string;
  expiresAt: string;
  burnAfterRead: boolean;
  maxReads?: number;
  readCount: number;
  linkEnabled: boolean;
  recipientEntityRefs: string[];
}

/**
 * A paste shared with the caller, together with the wrapped key their device needs.
 *
 * @public
 */
export interface SharedPaste extends PasteSummary {
  wrappedKey: WrappedKey;
}

/**
 * Response body of `GET /pastes/:id`. A link reader gets no wrapped key: their key
 * comes from the URL fragment, which never reaches the backend.
 *
 * @public
 */
export interface PasteReadResponse {
  paste: PasteSummary;
  wrappedKey?: WrappedKey;
}

/**
 * One entry of a paste's read trail. Records who opened a paste and when, never what.
 *
 * @public
 */
export interface PasteReadEntry {
  readerEntityRef?: string;
  via: 'recipient' | 'link';
  readAt: string;
}
