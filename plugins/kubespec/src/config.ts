import type { ConfigApi } from '@backstage/core-plugin-api';

const CONFIG_ROOT = 'kubespec';

export interface KubespecFrontendConfig {
  defaultSourceId: string;
  /** Absent when unconfigured, in which case empty states drop the call to action. */
  contributeUrl?: string;
}

export function readKubespecConfig(configApi: ConfigApi): KubespecFrontendConfig {
  const config = configApi.getOptionalConfig(CONFIG_ROOT);

  return {
    defaultSourceId: config?.getOptionalString('defaultSource') ?? 'kubernetes',
    contributeUrl: config?.getOptionalString('contributeUrl'),
  };
}
