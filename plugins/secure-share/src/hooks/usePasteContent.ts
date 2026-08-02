import { useApi } from '@backstage/core-plugin-api';
import { PasteSummary } from '@sbordeyne/secure-share-common';
import useAsync from 'react-use/lib/useAsync';
import { SecureShareApi, secureShareApiRef } from '../api';
import { decryptPayload, importDataKeyFromLink, openMetadata, PasteMetadata, unwrapDataKey } from '../crypto';

/** How the reader is allowed to open this paste. */
export type PasteAccess =
  | { via: 'recipient'; deviceKeyId: string; privateKey: CryptoKey }
  | { via: 'link'; linkToken: string; dataKey: string };

/** @public */
export interface PasteContent {
  summary: PasteSummary;
  metadata: PasteMetadata;
  payload: Blob;
}

/** @public */
export interface PasteContentState {
  value?: PasteContent;
  loading: boolean;
  error?: Error;
}

/**
 * Fetches a paste and decrypts it in the browser.
 *
 * The chunk count sealed by the sender is compared with the one the backend reports. They
 * can only differ if the payload was truncated or padded in transit, which is the one
 * tampering that per-chunk authentication alone would not reveal.
 *
 * @public
 */
export function usePasteContent(options: { pasteId: string; access?: PasteAccess }): PasteContentState {
  const secureShareApi = useApi(secureShareApiRef);
  const { access, pasteId } = options;

  const { value, loading, error } = useAsync(async () => {
    if (!access) {
      return undefined;
    }
    return await openPaste({ pasteId, access, secureShareApi });
  }, [pasteId, access, secureShareApi]);

  return { value, loading, error };
}

async function openPaste(options: {
  pasteId: string;
  access: PasteAccess;
  secureShareApi: SecureShareApi;
}): Promise<PasteContent> {
  const { pasteId, access, secureShareApi } = options;
  const read =
    access.via === 'link'
      ? await secureShareApi.readLinkedPaste({ pasteId, linkToken: access.linkToken })
      : await secureShareApi.readPaste({ pasteId, deviceKeyId: access.deviceKeyId });

  const dataKey = await resolveDataKey({ access, wrappedKey: read.wrappedKey });
  const metadata = await openMetadata(read.paste.metaCiphertext, dataKey);
  assertPayloadIntact({ metadata, summary: read.paste });

  const payload = await decryptPayload({
    chunks: fetchChunks({ pasteId, access, secureShareApi, chunkCount: metadata.chunkCount }),
    dataKey,
    mimeType: metadata.mimeType,
  });
  return { summary: read.paste, metadata, payload };
}

async function resolveDataKey(options: {
  access: PasteAccess;
  wrappedKey: Parameters<typeof unwrapDataKey>[0]['wrappedKey'] | undefined;
}): Promise<CryptoKey> {
  if (options.access.via === 'link') {
    return await importDataKeyFromLink(options.access.dataKey);
  }
  if (!options.wrappedKey) {
    throw new Error('This paste carries no key for this device, so it cannot be read here');
  }
  return await unwrapDataKey({ wrappedKey: options.wrappedKey, privateKey: options.access.privateKey });
}

async function* fetchChunks(options: {
  pasteId: string;
  access: PasteAccess;
  secureShareApi: SecureShareApi;
  chunkCount: number;
}): AsyncGenerator<Uint8Array> {
  for (let index = 0; index < options.chunkCount; index += 1) {
    yield options.access.via === 'link'
      ? await options.secureShareApi.fetchLinkedChunk({
          pasteId: options.pasteId,
          index,
          linkToken: options.access.linkToken,
        })
      : await options.secureShareApi.fetchChunk({
          pasteId: options.pasteId,
          index,
          deviceKeyId: options.access.deviceKeyId,
        });
  }
}

function assertPayloadIntact(options: { metadata: PasteMetadata; summary: PasteSummary }): void {
  if (options.metadata.chunkCount !== options.summary.chunkCount) {
    throw new Error(
      'This paste does not have the number of chunks its sender sealed, so it has been altered in transit',
    );
  }
}
