import { configApiRef, useApi } from '@backstage/core-plugin-api';
import { readSecureShareSharedConfig, SecureShareSharedConfig } from '@sbordeyne/secure-share-common';
import { useMemo } from 'react';

/**
 * Reads the frontend visible part of the `secureShare` config.
 *
 * The same reader runs in the backend, so the limits enforced in the form are the ones
 * the backend will enforce again on the request.
 *
 * @public
 */
export function useSecureShareConfig(): SecureShareSharedConfig {
  const configApi = useApi(configApiRef);
  return useMemo(() => readSecureShareSharedConfig(configApi), [configApi]);
}
