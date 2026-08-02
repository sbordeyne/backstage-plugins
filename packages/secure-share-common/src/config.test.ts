import { ConfigReader } from '@backstage/config';
import { readSecureShareSharedConfig } from './config';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MB = 1024 * 1024;

describe('readSecureShareSharedConfig', () => {
  it('applies defaults when the secureShare key is absent', () => {
    const shared = readSecureShareSharedConfig(new ConfigReader({}));

    expect(shared).toEqual({
      card: { limit: 5 },
      expiration: {
        defaultMs: 24 * HOUR_MS,
        maxMs: 7 * DAY_MS,
        optionsMs: [HOUR_MS, 8 * HOUR_MS, 24 * HOUR_MS, 7 * DAY_MS],
      },
      limits: {
        maxFileSizeBytes: 100 * MB,
        maxTextSizeBytes: MB,
        chunkSizeBytes: 4 * MB,
        maxRecipientKeys: 500,
      },
    });
  });

  it('reads every configured value', () => {
    const shared = readSecureShareSharedConfig(
      new ConfigReader({
        secureShare: {
          card: { limit: 3 },
          expiration: { default: { hours: 2 }, max: { days: 1 }, options: [{ minutes: 30 }, { hours: 2 }] },
          limits: { maxFileSize: '20MB', maxTextSize: '256KB', chunkSize: '1MB', maxRecipientKeys: 50 },
        },
      }),
    );

    expect(shared.card.limit).toBe(3);
    expect(shared.expiration).toEqual({
      defaultMs: 2 * HOUR_MS,
      maxMs: DAY_MS,
      optionsMs: [30 * 60 * 1000, 2 * HOUR_MS],
    });
    expect(shared.limits).toEqual({
      maxFileSizeBytes: 20 * MB,
      maxTextSizeBytes: 256 * 1024,
      chunkSizeBytes: MB,
      maxRecipientKeys: 50,
    });
  });

  it('rejects a default expiration longer than the maximum', () => {
    const config = new ConfigReader({
      secureShare: { expiration: { default: { days: 30 }, max: { days: 7 } } },
    });

    expect(() => readSecureShareSharedConfig(config)).toThrow(/default must not exceed/);
  });

  it('rejects an expiration option longer than the maximum', () => {
    const config = new ConfigReader({
      secureShare: {
        expiration: { default: { hours: 1 }, max: { hours: 1 }, options: [{ hours: 1 }, { days: 2 }] },
      },
    });

    expect(() => readSecureShareSharedConfig(config)).toThrow(/options entry must not exceed/);
  });

  it('rejects an empty list of expiration options', () => {
    const config = new ConfigReader({ secureShare: { expiration: { options: [] } } });

    expect(() => readSecureShareSharedConfig(config)).toThrow(/must not be empty/);
  });

  it('rejects a chunk size larger than the maximum file size', () => {
    const config = new ConfigReader({
      secureShare: { limits: { maxFileSize: '1MB', chunkSize: '4MB' } },
    });

    expect(() => readSecureShareSharedConfig(config)).toThrow(/chunkSize must not exceed/);
  });

  it.each([0, -1, 1.5])('rejects a card limit of %s', limit => {
    const config = new ConfigReader({ secureShare: { card: { limit } } });

    expect(() => readSecureShareSharedConfig(config)).toThrow(/card.limit must be a positive integer/);
  });

  it('rejects a non integer recipient key cap', () => {
    const config = new ConfigReader({ secureShare: { limits: { maxRecipientKeys: 0 } } });

    expect(() => readSecureShareSharedConfig(config)).toThrow(/maxRecipientKeys must be a positive integer/);
  });
});
