import { Config, readDurationFromConfig } from '@backstage/config';
import { durationToMilliseconds, HumanDuration } from '@backstage/types';
import { InputError } from '@backstage/errors';
import { readSecureShareSharedConfig, SecureShareSharedConfig } from '@sbordeyne/secure-share-common';

const DEFAULT_LOCAL_PATH = './secure-share-blobs';
const DEFAULT_GCS_PREFIX = 'pastes/';
const DEFAULT_CLEANUP_FREQUENCY: HumanDuration = { minutes: 10 };
const DEFAULT_BURN_GRACE_PERIOD: HumanDuration = { minutes: 5 };
const DEFAULT_MAX_DEVICE_KEYS_PER_USER = 10;

/**
 * Where encrypted chunks are written. Never exposed to the frontend.
 *
 * @public
 */
export type SecureShareStorageConfig =
  | { type: 'local'; path: string }
  | { type: 'gcs'; bucket: string; prefix: string; keyFilename?: string };

/** @public */
export interface SecureShareCleanupConfig {
  frequency: HumanDuration;
  burnGracePeriodMs: number;
}

/** @public */
export interface SecureShareBackendConfig {
  shared: SecureShareSharedConfig;
  storage: SecureShareStorageConfig;
  cleanup: SecureShareCleanupConfig;
  maxDeviceKeysPerUser: number;
}

/**
 * Reads the full `secureShare` config block, applying defaults.
 *
 * @public
 */
export function readSecureShareBackendConfig(rootConfig: Config): SecureShareBackendConfig {
  const config = rootConfig.getOptionalConfig('secureShare');
  return {
    shared: readSecureShareSharedConfig(rootConfig),
    storage: readStorageConfig(config?.getOptionalConfig('storage')),
    cleanup: readCleanupConfig(config?.getOptionalConfig('cleanup')),
    maxDeviceKeysPerUser: readMaxDeviceKeysPerUser(config?.getOptionalConfig('limits')),
  };
}

function readStorageConfig(config: Config | undefined): SecureShareStorageConfig {
  const type = config?.getOptionalString('type') ?? 'local';
  if (type === 'local') {
    return { type, path: config?.getOptionalString('local.path') ?? DEFAULT_LOCAL_PATH };
  }
  if (type === 'gcs') {
    return {
      type,
      bucket: mustGetGcsConfig(config).getString('bucket'),
      prefix: config?.getOptionalString('gcs.prefix') ?? DEFAULT_GCS_PREFIX,
      keyFilename: config?.getOptionalString('gcs.keyFilename'),
    };
  }
  throw new InputError(`Unknown secureShare.storage.type '${type}', expected 'local' or 'gcs'`);
}

function mustGetGcsConfig(config: Config | undefined): Config {
  const gcsConfig = config?.getOptionalConfig('gcs');
  if (!gcsConfig) {
    throw new InputError("secureShare.storage.gcs is required when storage type is 'gcs'");
  }
  return gcsConfig;
}

function readCleanupConfig(config: Config | undefined): SecureShareCleanupConfig {
  return {
    frequency: config?.has('frequency')
      ? readDurationFromConfig(config, { key: 'frequency' })
      : DEFAULT_CLEANUP_FREQUENCY,
    burnGracePeriodMs: durationToMilliseconds(
      config?.has('burnGracePeriod')
        ? readDurationFromConfig(config, { key: 'burnGracePeriod' })
        : DEFAULT_BURN_GRACE_PERIOD,
    ),
  };
}

function readMaxDeviceKeysPerUser(config: Config | undefined): number {
  const maxDeviceKeysPerUser = config?.getOptionalNumber('maxDeviceKeysPerUser') ?? DEFAULT_MAX_DEVICE_KEYS_PER_USER;
  if (!Number.isInteger(maxDeviceKeysPerUser) || maxDeviceKeysPerUser < 1) {
    throw new InputError(
      `secureShare.limits.maxDeviceKeysPerUser must be a positive integer, got '${maxDeviceKeysPerUser}'`,
    );
  }
  return maxDeviceKeysPerUser;
}
