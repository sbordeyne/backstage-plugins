import { LoggerService } from '@backstage/backend-plugin-api';
import { SecureShareStorageConfig } from '../config';
import { BlobStore } from './BlobStore';
import { GcsBlobStore } from './GcsBlobStore';
import { LocalBlobStore } from './LocalBlobStore';

export type { BlobStore, ChunkLocation, WriteChunkOptions } from './BlobStore';
export { GcsBlobStore } from './GcsBlobStore';
export { LocalBlobStore } from './LocalBlobStore';

/**
 * Builds the blob store described by `secureShare.storage`.
 *
 * @public
 */
export function createBlobStore(options: { config: SecureShareStorageConfig; logger: LoggerService }): BlobStore {
  const { config, logger } = options;
  if (config.type === 'gcs') {
    logger.info(`Storing encrypted secure-share chunks in gs://${config.bucket}/${config.prefix}`);
    return GcsBlobStore.create({
      bucket: config.bucket,
      prefix: config.prefix,
      keyFilename: config.keyFilename,
      logger,
    });
  }
  logger.info(`Storing encrypted secure-share chunks under '${config.path}'`);
  return LocalBlobStore.create({ rootPath: config.path });
}
