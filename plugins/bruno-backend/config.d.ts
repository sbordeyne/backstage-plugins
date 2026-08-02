/** Settings shared by the object store sources, which differ only in which store they talk to. */
interface BrunoObjectStoreSource {
  /** Bucket holding the report artifacts. */
  bucket: string;

  /**
   * Object name prefix scanned by the sync worker.
   * @default 'ui_tests/reports/bruno/'
   */
  prefix?: string;

  /**
   * Directory an object must sit directly under to be considered, so a run directory holding
   * several suites contributes only the one named here. Set to `false` to accept every object
   * under the prefix.
   * @default 'unit'
   */
  requiredPathSegment?: string | false;
}

export interface Config {
  bruno?: {
    /**
     * Where report artifacts are read from. Defaults to GCS, for the bucket named by the
     * deprecated `bucket` key.
     */
    source?: {
      /**
       * @default 'gcs'
       */
      type?: 'gcs' | 's3' | 'github';

      /** Google Cloud Storage. Credentials come from Application Default Credentials. */
      gcs?: BrunoObjectStoreSource;

      /**
       * S3. Credentials come from the `aws` config block, or from the ambient AWS credential
       * chain when there is none.
       */
      s3?: BrunoObjectStoreSource & {
        /** Region of the bucket. Falls back to the credentials' STS region, then `AWS_REGION`. */
        region?: string;

        /** Alternative endpoint, for an S3-compatible store such as MinIO. */
        endpoint?: string;

        /**
         * Addresses the bucket as a path rather than a subdomain, which S3-compatible stores
         * usually require.
         * @default false
         */
        forcePathStyle?: boolean;

        /** AWS account id to take credentials for, when `aws.accounts` holds more than one. */
        accountId?: string;
      };

      /**
       * GitHub Actions artifacts. Credentials come from the matching `integrations.github` entry.
       *
       * An artifact listing says nothing about what is inside the zip, so the **artifact name** is
       * what a report annotation is matched against: name the artifact after the report file.
       */
      github?: {
        /** Repository holding the workflow runs, as `owner/repo`. */
        repository: string;

        /**
         * Host of the GitHub instance, matched against `integrations.github`.
         * @default 'github.com'
         */
        host?: string;

        /**
         * Only artifacts whose name starts with this are considered, and the prefix is stripped
         * before the name is matched against the annotation.
         * @default ''
         */
        namePrefix?: string;

        /**
         * Only artifacts produced by a workflow run on this branch are considered. Defaults to
         * accepting every branch.
         */
        branch?: string;
      };
    };

    /**
     * GCS bucket holding the Bruno report artifacts.
     * @deprecated Use `source.gcs.bucket`.
     * @default '1e42-exchange'
     */
    bucket?: string;

    /**
     * Object name prefix scanned by the sync worker.
     * @deprecated Use `source.gcs.prefix`.
     * @default 'ui_tests/reports/bruno/'
     */
    objectPrefix?: string;

    /**
     * Entity annotation naming the report an entity owns.
     * @default 'usebruno.com/report-path'
     */
    reportAnnotation?: string;

    retention?: {
      /**
       * How many runs to keep per entity, newest first. Set to -1 to keep
       * everything — note that disables the only bound on table growth.
       * @default 20
       */
      runsPerEntity?: number;
    };

    sync?: {
      /**
       * @default true
       */
      enabled?: boolean;

      /**
       * How many artifacts to download in parallel.
       * @default 5
       */
      concurrency?: number;

      /**
       * Artifacts larger than this are skipped entirely. Also caps what a GitHub artifact may
       * unpack to, so a small archive cannot expand without bound.
       * @default 26214400
       */
      maxObjectSizeBytes?: number;

      /**
       * Request and response bodies are truncated to this many bytes before
       * being stored, so the detail endpoint can never return a huge payload.
       * @default 262144
       */
      maxStoredBodyBytes?: number;

      /**
       * Ignore artifacts created longer ago than this. The main lever on the
       * cost of listing the whole bucket prefix. Omit to consider every object.
       */
      maxArtifactAge?: {
        days?: number;
        hours?: number;
      };

      /**
       * Standard scheduler task schedule.
       */
      schedule?: {
        frequency: { [key: string]: number } | string;
        timeout: { [key: string]: number } | string;
        initialDelay?: { [key: string]: number } | string;
        scope?: 'global' | 'local';
      };
    };
  };
}
