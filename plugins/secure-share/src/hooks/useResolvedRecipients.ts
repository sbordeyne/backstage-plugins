import { useApi } from '@backstage/core-plugin-api';
import { ResolveRecipientsResponse } from '@sbordeyne/secure-share-common';
import useAsync from 'react-use/lib/useAsync';
import { secureShareApiRef } from '../api';

const EMPTY_RESOLUTION: ResolveRecipientsResponse = {
  recipients: [],
  unresolvedEntityRefs: [],
  userEntityRefsWithoutKeys: [],
  totalKeyCount: 0,
};

/** @public */
export interface ResolvedRecipientsState {
  value: ResolveRecipientsResponse;
  loading: boolean;
  error?: Error;
}

/**
 * Expands the picked users and groups into the device keys a paste must be wrapped for.
 *
 * Resolving before sending is what lets the form warn that some members have never
 * enrolled a browser, and therefore cannot be given access.
 *
 * @public
 */
export function useResolvedRecipients(entityRefs: string[]): ResolvedRecipientsState {
  const secureShareApi = useApi(secureShareApiRef);
  const refsKey = [...entityRefs].sort().join(',');

  const { value, loading, error } = useAsync(async () => {
    if (entityRefs.length === 0) {
      return EMPTY_RESOLUTION;
    }
    return await secureShareApi.resolveRecipients({ entityRefs });
    // The joined refs are the real input: a new array with the same refs must not refetch.
  }, [refsKey, secureShareApi]);

  return { value: value ?? EMPTY_RESOLUTION, loading, error };
}
