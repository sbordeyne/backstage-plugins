import { Config, readDurationFromConfig } from '@backstage/config';
import { InputError } from '@backstage/errors';
import { durationToMilliseconds } from '@backstage/types';
import { parseByteSize } from './bytes';

const DEFAULT_CARD_LIMIT = 5;
const DEFAULT_EXPIRATION = { hours: 24 };
const DEFAULT_MAX_EXPIRATION = { days: 7 };
const DEFAULT_EXPIRATION_OPTIONS = [{ hours: 1 }, { hours: 8 }, { hours: 24 }, { days: 7 }];
const DEFAULT_MAX_FILE_SIZE = '100MB';
const DEFAULT_MAX_TEXT_SIZE = '1MB';
const DEFAULT_CHUNK_SIZE = '4MB';
const DEFAULT_MAX_RECIPIENT_KEYS = 500;

/** @public */
export interface SecureShareCardConfig {
  limit: number;
}

/** @public */
export interface SecureShareExpirationConfig {
  defaultMs: number;
  maxMs: number;
  optionsMs: number[];
}

/** @public */
export interface SecureShareLimitsConfig {
  maxFileSizeBytes: number;
  maxTextSizeBytes: number;
  chunkSizeBytes: number;
  maxRecipientKeys: number;
}

/**
 * The parts of the `secureShare` config that both the frontend and the backend need.
 *
 * The frontend enforces these limits to give immediate feedback; the backend
 * re-enforces every one of them, because a client side check is not a control.
 *
 * @public
 */
export interface SecureShareSharedConfig {
  card: SecureShareCardConfig;
  expiration: SecureShareExpirationConfig;
  limits: SecureShareLimitsConfig;
}

/**
 * Reads the frontend visible part of the `secureShare` config, applying defaults.
 *
 * @public
 */
export function readSecureShareSharedConfig(rootConfig: Config): SecureShareSharedConfig {
  const config = rootConfig.getOptionalConfig('secureShare');
  const shared: SecureShareSharedConfig = {
    card: readCardConfig(config?.getOptionalConfig('card')),
    expiration: readExpirationConfig(config?.getOptionalConfig('expiration')),
    limits: readLimitsConfig(config?.getOptionalConfig('limits')),
  };
  assertConsistentLimits(shared);
  return shared;
}

function readCardConfig(config: Config | undefined): SecureShareCardConfig {
  const limit = config?.getOptionalNumber('limit') ?? DEFAULT_CARD_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new InputError(`secureShare.card.limit must be a positive integer, got '${limit}'`);
  }
  return { limit };
}

function readExpirationConfig(config: Config | undefined): SecureShareExpirationConfig {
  return {
    defaultMs: readDurationMs(config, 'default', DEFAULT_EXPIRATION),
    maxMs: readDurationMs(config, 'max', DEFAULT_MAX_EXPIRATION),
    optionsMs: readExpirationOptionsMs(config),
  };
}

function readDurationMs(config: Config | undefined, key: string, fallback: { hours?: number; days?: number }): number {
  if (!config?.has(key)) {
    return durationToMilliseconds(fallback);
  }
  return durationToMilliseconds(readDurationFromConfig(config, { key }));
}

function readExpirationOptionsMs(config: Config | undefined): number[] {
  const optionConfigs = config?.getOptionalConfigArray('options');
  if (!optionConfigs) {
    return DEFAULT_EXPIRATION_OPTIONS.map(durationToMilliseconds);
  }
  if (optionConfigs.length === 0) {
    throw new InputError('secureShare.expiration.options must not be empty');
  }
  return optionConfigs.map(optionConfig => durationToMilliseconds(readDurationFromConfig(optionConfig)));
}

function readLimitsConfig(config: Config | undefined): SecureShareLimitsConfig {
  const maxRecipientKeys = config?.getOptionalNumber('maxRecipientKeys') ?? DEFAULT_MAX_RECIPIENT_KEYS;
  if (!Number.isInteger(maxRecipientKeys) || maxRecipientKeys < 1) {
    throw new InputError(`secureShare.limits.maxRecipientKeys must be a positive integer, got '${maxRecipientKeys}'`);
  }
  return {
    maxFileSizeBytes: readByteSize(config, 'maxFileSize', DEFAULT_MAX_FILE_SIZE),
    maxTextSizeBytes: readByteSize(config, 'maxTextSize', DEFAULT_MAX_TEXT_SIZE),
    chunkSizeBytes: readByteSize(config, 'chunkSize', DEFAULT_CHUNK_SIZE),
    maxRecipientKeys,
  };
}

function readByteSize(config: Config | undefined, key: string, fallback: string): number {
  return parseByteSize(config?.getOptionalString(key) ?? fallback);
}

function assertConsistentLimits(shared: SecureShareSharedConfig): void {
  const { expiration, limits } = shared;
  if (expiration.defaultMs > expiration.maxMs) {
    throw new InputError('secureShare.expiration.default must not exceed secureShare.expiration.max');
  }
  const tooLongOption = expiration.optionsMs.find(optionMs => optionMs > expiration.maxMs);
  if (tooLongOption !== undefined) {
    throw new InputError('every secureShare.expiration.options entry must not exceed secureShare.expiration.max');
  }
  if (limits.chunkSizeBytes > limits.maxFileSizeBytes) {
    throw new InputError('secureShare.limits.chunkSize must not exceed secureShare.limits.maxFileSize');
  }
}
