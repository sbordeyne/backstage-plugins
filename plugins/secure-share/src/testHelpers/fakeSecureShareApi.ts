import {
  CreatePasteRequest,
  CreatePasteResponse,
  DeviceKey,
  DeviceKeySummary,
  EcdhPublicKeyJwk,
  EnrollDeviceKeyRequest,
  PasteReadEntry,
  PasteReadResponse,
  PasteSummary,
  ResolveRecipientsResponse,
  SharedPaste,
  WrappedKey,
} from '@sbordeyne/secure-share-common';
import { SecureShareApi } from '../api';

const LINK_TOKEN = 'fake-link-token';

interface StoredPaste {
  summary: PasteSummary;
  wrappedKeys: WrappedKey[];
  chunks: Uint8Array[];
  finalized: boolean;
}

/**
 * An in-memory stand-in for the backend, holding exactly what the real one holds:
 * ciphertext, wrapped keys and metadata it cannot read. Used to exercise the browser side
 * of a paste end to end.
 */
export interface FakeSecureShareApi extends SecureShareApi {
  pastes: Map<string, StoredPaste>;
  enrolledKeys: DeviceKey[];
  linkToken: string;
  enrollFakeDevice(options: { publicKey: EcdhPublicKeyJwk; userEntityRef?: string }): DeviceKey;
  resolvedRecipients(): ResolveRecipientsResponse;
}

export function createFakeSecureShareApi(): FakeSecureShareApi {
  const pastes = new Map<string, StoredPaste>();
  const enrolledKeys: DeviceKey[] = [];
  let nextPasteId = 0;

  function mustGet(pasteId: string): StoredPaste {
    const paste = pastes.get(pasteId);
    if (!paste) {
      throw new Error(`Paste ${pasteId} not found`);
    }
    return paste;
  }

  const api: FakeSecureShareApi = {
    pastes,
    enrolledKeys,
    linkToken: LINK_TOKEN,

    enrollFakeDevice({ publicKey }) {
      const deviceKey: DeviceKey = {
        id: `device-${enrolledKeys.length + 1}`,
        publicKey,
        fingerprint: `fingerprint-${enrolledKeys.length + 1}`,
        label: 'Chrome',
        createdAt: '2026-08-01T10:00:00.000Z',
      };
      enrolledKeys.push(deviceKey);
      return deviceKey;
    },

    resolvedRecipients() {
      return {
        recipients: [{ userEntityRef: 'user:default/bob', viaEntityRefs: ['user:default/bob'], keys: enrolledKeys }],
        unresolvedEntityRefs: [],
        userEntityRefsWithoutKeys: [],
        totalKeyCount: enrolledKeys.length,
      };
    },

    async enrollDeviceKey(request: EnrollDeviceKeyRequest): Promise<DeviceKeySummary> {
      const { publicKey, ...summary } = api.enrollFakeDevice({ publicKey: request.publicKey });
      return { ...summary, label: request.label };
    },

    async listDeviceKeys(): Promise<DeviceKeySummary[]> {
      return enrolledKeys.map(({ publicKey, ...summary }) => summary);
    },

    async revokeDeviceKey(): Promise<void> {},

    async resolveRecipients(): Promise<ResolveRecipientsResponse> {
      return api.resolvedRecipients();
    },

    async createPaste(request: CreatePasteRequest): Promise<CreatePasteResponse> {
      nextPasteId += 1;
      const id = `paste-${nextPasteId}`;
      pastes.set(id, {
        summary: {
          id,
          kind: request.kind,
          createdByEntityRef: 'user:default/alice',
          metaCiphertext: request.metaCiphertext,
          chunkCount: request.chunkCount,
          sizeBytes: request.sizeBytes,
          createdAt: '2026-08-01T10:00:00.000Z',
          expiresAt: request.expiresAt,
          burnAfterRead: request.burnAfterRead,
          maxReads: request.maxReads,
          readCount: 0,
          linkEnabled: request.linkEnabled,
          recipientEntityRefs: request.recipientEntityRefs,
        },
        wrappedKeys: request.wrappedKeys,
        chunks: [],
        finalized: false,
      });
      return { id, linkToken: request.linkEnabled ? LINK_TOKEN : undefined };
    },

    async uploadChunk({ pasteId, index, data }): Promise<void> {
      mustGet(pasteId).chunks[index] = data;
    },

    async finalizePaste(pasteId: string): Promise<void> {
      mustGet(pasteId).finalized = true;
    },

    async listSharedWithMe({ deviceKeyId, limit }): Promise<SharedPaste[]> {
      return [...pastes.values()]
        .filter(paste => paste.finalized)
        .flatMap(paste => {
          const wrappedKey = paste.wrappedKeys.find(key => key.deviceKeyId === deviceKeyId);
          return wrappedKey ? [{ ...paste.summary, wrappedKey }] : [];
        })
        .slice(0, limit);
    },

    async listMyPastes(): Promise<PasteSummary[]> {
      return [...pastes.values()].map(paste => paste.summary);
    },

    async readPaste({ pasteId, deviceKeyId }): Promise<PasteReadResponse> {
      const paste = mustGet(pasteId);
      return {
        paste: paste.summary,
        wrappedKey: paste.wrappedKeys.find(key => key.deviceKeyId === deviceKeyId),
      };
    },

    async fetchChunk({ pasteId, index }): Promise<Uint8Array> {
      return mustGet(pasteId).chunks[index];
    },

    async readLinkedPaste({ pasteId, linkToken }): Promise<PasteReadResponse> {
      if (linkToken !== LINK_TOKEN) {
        throw new Error('Paste not found or no longer available');
      }
      return { paste: mustGet(pasteId).summary };
    },

    async fetchLinkedChunk({ pasteId, index, linkToken }): Promise<Uint8Array> {
      if (linkToken !== LINK_TOKEN) {
        throw new Error('Paste not found or no longer available');
      }
      return mustGet(pasteId).chunks[index];
    },

    async listPasteReads(): Promise<PasteReadEntry[]> {
      return [];
    },

    async deletePaste(pasteId: string): Promise<void> {
      pastes.delete(pasteId);
    },
  };

  return api;
}
