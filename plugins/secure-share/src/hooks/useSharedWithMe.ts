import { useApi } from '@backstage/core-plugin-api';
import { PasteSummary, SharedPaste } from '@sbordeyne/secure-share-common';
import useAsync from 'react-use/lib/useAsync';
import { SecureShareApi, secureShareApiRef } from '../api';
import { openMetadata, unwrapDataKey } from '../crypto';
import { EnrolledDeviceKey, useDeviceKey } from './useDeviceKey';

/** A paste shared with the caller, with its title decrypted for display. */
export interface SharedPasteView {
  summary: PasteSummary;
  title: string;
  /** Set when the title could not be decrypted, which means the paste is not readable here. */
  unreadable?: boolean;
}

/** @public */
export interface SharedWithMeState {
  value: SharedPasteView[];
  loading: boolean;
  error?: Error;
  /** True when this browser has no enrolled key, so nothing can be decrypted here. */
  deviceMissing: boolean;
}

/**
 * Lists the pastes this browser can decrypt, with their titles opened locally.
 *
 * Titles are sealed with the paste, so the list the backend returns is unreadable until
 * each entry's data key is unwrapped here.
 *
 * @public
 */
export function useSharedWithMe(options: { limit?: number } = {}): SharedWithMeState {
  const secureShareApi = useApi(secureShareApiRef);
  const { deviceKey, loading: deviceKeyLoading } = useDeviceKey();

  const { value, loading, error } = useAsync(async () => {
    if (!deviceKey) {
      return [];
    }
    return await loadSharedPastes({ deviceKey, limit: options.limit, secureShareApi });
  }, [deviceKey, options.limit, secureShareApi]);

  return {
    value: value ?? [],
    loading: loading || deviceKeyLoading,
    error,
    deviceMissing: !deviceKeyLoading && !deviceKey,
  };
}

async function loadSharedPastes(options: {
  deviceKey: EnrolledDeviceKey;
  limit?: number;
  secureShareApi: SecureShareApi;
}): Promise<SharedPasteView[]> {
  const shared = await options.secureShareApi.listSharedWithMe({
    deviceKeyId: options.deviceKey.deviceKeyId,
    limit: options.limit,
  });
  return await Promise.all(shared.map(paste => describePaste({ paste, privateKey: options.deviceKey.privateKey })));
}

async function describePaste(options: { paste: SharedPaste; privateKey: CryptoKey }): Promise<SharedPasteView> {
  try {
    const dataKey = await unwrapDataKey({ wrappedKey: options.paste.wrappedKey, privateKey: options.privateKey });
    const metadata = await openMetadata(options.paste.metaCiphertext, dataKey);
    return { summary: options.paste, title: metadata.title };
    // One unreadable entry must not hide the rest of the list: it is reported in place.
  } catch {
    return { summary: options.paste, title: 'Cannot be decrypted by this browser', unreadable: true };
  }
}
