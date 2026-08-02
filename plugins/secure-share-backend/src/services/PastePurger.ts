import { LoggerService } from '@backstage/backend-plugin-api';
import { PasteStore } from '../database/PasteStore';
import { BlobStore } from '../storage';

const BATCH_SIZE = 100;
const MAX_BATCHES = 50;

interface PastePurgerOptions {
  pastes: PasteStore;
  blobStore: BlobStore;
  burnGracePeriodMs: number;
  logger: LoggerService;
}

/**
 * Removes pastes that have expired, been fully read, or been burned and passed their
 * retry grace period.
 *
 * Ciphertext is deleted before the row that points at it, so a crash between the two
 * leaves an orphaned blob rather than a database row that promises unreachable data.
 * Read trail rows are kept on purpose: they record that a paste was opened, never what
 * it held.
 *
 * @public
 */
export class PastePurger {
  readonly #pastes: PasteStore;
  readonly #blobStore: BlobStore;
  readonly #burnGracePeriodMs: number;
  readonly #logger: LoggerService;

  static create(options: PastePurgerOptions): PastePurger {
    return new PastePurger(options);
  }

  private constructor(options: PastePurgerOptions) {
    this.#pastes = options.pastes;
    this.#blobStore = options.blobStore;
    this.#burnGracePeriodMs = options.burnGracePeriodMs;
    this.#logger = options.logger;
  }

  /** Purges every eligible paste and returns how many were removed. */
  async purge(): Promise<number> {
    const now = new Date();
    const burnGraceBefore = new Date(now.getTime() - this.#burnGracePeriodMs);
    let purgedCount = 0;

    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const purgeable = await this.#pastes.listPurgeable({ now, burnGraceBefore, limit: BATCH_SIZE });
      if (purgeable.length === 0) {
        break;
      }

      let purgedInBatch = 0;
      for (const paste of purgeable) {
        if (await this.#tryPurge(paste)) {
          purgedInBatch += 1;
        }
      }
      purgedCount += purgedInBatch;

      // A batch where nothing could be deleted would be selected again unchanged, so
      // stop and let the next scheduled run retry instead of spinning.
      if (purgedInBatch === 0) {
        break;
      }
    }

    if (purgedCount > 0) {
      this.#logger.info(`Purged ${purgedCount} expired or consumed pastes`);
    }
    return purgedCount;
  }

  /** Returns whether the paste was removed. */
  async #tryPurge(paste: { id: string; storageKey: string }): Promise<boolean> {
    try {
      await this.#blobStore.deleteAll({ storageKey: paste.storageKey });
    } catch (error) {
      this.#logger.error(`Failed to delete the ciphertext of paste ${paste.id}, keeping its row for the next run`, {
        error: String(error),
      });
      return false;
    }
    await this.#pastes.delete(paste.id);
    return true;
  }
}
