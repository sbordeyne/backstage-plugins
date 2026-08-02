import { HumanDuration } from '@backstage/types';

export interface Config {
  secureShare?: {
    /**
     * Homepage card behaviour.
     */
    card?: {
      /**
       * How many pastes the "Shared with me" card shows. Defaults to 5.
       *
       * @visibility frontend
       */
      limit?: number;
    };

    /**
     * Bounds on how long a paste may live. Every paste expires.
     */
    expiration?: {
      /**
       * Pre-selected lifetime in the create form. Defaults to 24 hours.
       *
       * @visibility frontend
       */
      default?: HumanDuration | string;
      /**
       * Longest lifetime a paste may be given. Defaults to 7 days.
       *
       * @visibility frontend
       */
      max?: HumanDuration | string;
      /**
       * Lifetimes offered in the create form. Defaults to 1h, 8h, 24h and 7d.
       *
       * @visibility frontend
       */
      options?: Array<HumanDuration | string>;
    };

    /**
     * Size limits. The frontend checks these for immediate feedback and the
     * backend enforces them again on every request.
     */
    limits?: {
      /**
       * Largest file that may be shared, e.g. `100MB`. Defaults to `100MB`.
       *
       * @visibility frontend
       */
      maxFileSize?: string;
      /**
       * Largest text paste that may be shared, e.g. `1MB`. Defaults to `1MB`.
       *
       * @visibility frontend
       */
      maxTextSize?: string;
      /**
       * Size of the chunks a payload is split into before encryption, e.g. `4MB`.
       * Defaults to `4MB`. Must not exceed `maxFileSize`.
       *
       * @visibility frontend
       */
      chunkSize?: string;
      /**
       * Cap on the number of recipient device keys a single paste may be wrapped
       * for, which bounds the cost of sharing with large groups. Defaults to 500.
       */
      maxRecipientKeys?: number;
      /**
       * Cap on the number of active device keys one user may enroll. Defaults to 10.
       */
      maxDeviceKeysPerUser?: number;
    };

    /**
     * Where encrypted payload chunks are stored. The backend only ever writes
     * ciphertext here; it holds no key material.
     *
     * Deliberately not frontend visible.
     */
    storage?: {
      /**
       * Storage backend to use. Defaults to `local`.
       */
      type?: 'local' | 'gcs';
      local?: {
        /**
         * Directory that holds encrypted chunks. Defaults to `./secure-share-blobs`.
         */
        path?: string;
      };
      gcs?: {
        /**
         * Name of the bucket that holds encrypted chunks.
         */
        bucket: string;
        /**
         * Key prefix inside the bucket. Defaults to `pastes/`.
         */
        prefix?: string;
        /**
         * Path to a service account key file. Falls back to application default
         * credentials when omitted.
         */
        keyFilename?: string;
      };
    };

    /**
     * Background purge of expired, consumed and fully read pastes.
     */
    cleanup?: {
      /**
       * How often the purge runs. Defaults to every 10 minutes.
       */
      frequency?: HumanDuration | string;
      /**
       * How long a burn-after-read paste survives after its first chunk is
       * fetched, so that an interrupted download can be retried. Defaults to
       * 5 minutes.
       */
      burnGracePeriod?: HumanDuration | string;
    };
  };
}
