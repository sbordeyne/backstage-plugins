import { useApi } from '@backstage/core-plugin-api';
import { PasteKind, ResolvedRecipient, WrappedKey } from '@sbordeyne/secure-share-common';
import { useCallback, useState } from 'react';
import { SecureShareApi, secureShareApiRef } from '../api';
import {
  computePayloadLayout,
  encryptPayloadChunks,
  exportDataKeyForLink,
  generateDataKey,
  sealMetadata,
  wrapDataKeyFor,
} from '../crypto';
import { useSecureShareConfig } from './useSecureShareConfig';

/** @public */
export interface CreatePasteInput {
  kind: PasteKind;
  payload: Blob;
  title: string;
  filename?: string;
  mimeType?: string;
  language?: string;
  markdown?: boolean;
  /** Recipients with their device keys, as resolved by the backend. */
  recipients: ResolvedRecipient[];
  /** The refs the sender picked, kept for display on the paste. */
  recipientEntityRefs: string[];
  expiresAt: Date;
  burnAfterRead: boolean;
  maxReads?: number;
  linkEnabled: boolean;
}

/** @public */
export interface CreatedPaste {
  pasteId: string;
  /** Present when a secret link was requested. Carries the key in its fragment. */
  linkUrl?: string;
}

/** @public */
export interface CreatePasteState {
  create: (input: CreatePasteInput) => Promise<CreatedPaste>;
  uploadedChunks: number;
  totalChunks: number;
  busy: boolean;
}

/**
 * Encrypts a paste in this browser and uploads the result.
 *
 * Order matters: the data key is created here, wrapped once per recipient device, and
 * then thrown away with the page. The backend is told how many chunks to expect, receives
 * them one at a time, and only seals the paste at the end.
 *
 * @public
 */
export function useCreatePaste(): CreatePasteState {
  const secureShareApi = useApi(secureShareApiRef);
  const config = useSecureShareConfig();
  const [uploadedChunks, setUploadedChunks] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  const [busy, setBusy] = useState(false);

  const create = useCallback(
    async (input: CreatePasteInput): Promise<CreatedPaste> => {
      setBusy(true);
      setUploadedChunks(0);
      try {
        const layout = computePayloadLayout({
          plaintextBytes: input.payload.size,
          chunkSizeBytes: config.limits.chunkSizeBytes,
        });
        setTotalChunks(layout.chunkCount);

        const dataKey = await generateDataKey();
        const created = await registerPaste({
          input,
          layout,
          dataKey,
          secureShareApi,
        });

        await uploadChunks({
          input,
          dataKey,
          pasteId: created.id,
          chunkSizeBytes: config.limits.chunkSizeBytes,
          secureShareApi,
          onChunkUploaded: index => setUploadedChunks(index + 1),
        });
        await secureShareApi.finalizePaste(created.id);

        return {
          pasteId: created.id,
          linkUrl: created.linkToken
            ? buildLinkUrl({
                pasteId: created.id,
                linkToken: created.linkToken,
                dataKey: await exportDataKeyForLink(dataKey),
              })
            : undefined,
        };
      } finally {
        setBusy(false);
      }
    },
    [config.limits.chunkSizeBytes, secureShareApi],
  );

  return { create, uploadedChunks, totalChunks, busy };
}

async function registerPaste(options: {
  input: CreatePasteInput;
  layout: { chunkCount: number; ciphertextBytes: number };
  dataKey: CryptoKey;
  secureShareApi: SecureShareApi;
}): Promise<{ id: string; linkToken?: string }> {
  const { input, layout, dataKey } = options;
  const metaCiphertext = await sealMetadata(
    {
      title: input.title,
      filename: input.filename,
      mimeType: input.mimeType,
      language: input.language,
      markdown: input.markdown,
      chunkCount: layout.chunkCount,
      plaintextBytes: input.payload.size,
    },
    dataKey,
  );

  return await options.secureShareApi.createPaste({
    kind: input.kind,
    metaCiphertext,
    chunkCount: layout.chunkCount,
    sizeBytes: layout.ciphertextBytes,
    expiresAt: input.expiresAt.toISOString(),
    burnAfterRead: input.burnAfterRead,
    maxReads: input.maxReads,
    linkEnabled: input.linkEnabled,
    recipientEntityRefs: input.recipientEntityRefs,
    wrappedKeys: await wrapForRecipients({ recipients: input.recipients, dataKey }),
  });
}

async function wrapForRecipients(options: {
  recipients: ResolvedRecipient[];
  dataKey: CryptoKey;
}): Promise<WrappedKey[]> {
  const wrappedKeys: WrappedKey[] = [];
  for (const recipient of options.recipients) {
    for (const key of recipient.keys) {
      wrappedKeys.push(
        await wrapDataKeyFor({ dataKey: options.dataKey, recipientPublicKey: key.publicKey, deviceKeyId: key.id }),
      );
    }
  }
  return wrappedKeys;
}

async function uploadChunks(options: {
  input: CreatePasteInput;
  dataKey: CryptoKey;
  pasteId: string;
  chunkSizeBytes: number;
  secureShareApi: SecureShareApi;
  onChunkUploaded: (index: number) => void;
}): Promise<void> {
  const chunks = encryptPayloadChunks({
    payload: options.input.payload,
    dataKey: options.dataKey,
    chunkSizeBytes: options.chunkSizeBytes,
  });
  for await (const chunk of chunks) {
    await options.secureShareApi.uploadChunk({ pasteId: options.pasteId, index: chunk.index, data: chunk.data });
    options.onChunkUploaded(chunk.index);
  }
}

/**
 * Both the link token and the data key go in the fragment, which browsers never send to a
 * server. The token authorizes fetching the ciphertext; the key decrypts it.
 */
function buildLinkUrl(options: { pasteId: string; linkToken: string; dataKey: string }): string {
  const fragment = new URLSearchParams({ t: options.linkToken, k: options.dataKey });
  return `${window.location.origin}/secure-share/link/${options.pasteId}#${fragment}`;
}
