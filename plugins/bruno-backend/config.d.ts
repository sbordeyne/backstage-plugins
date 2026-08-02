export interface Config {
  bruno?: {
    /**
     * GCS bucket holding the Bruno report artifacts.
     * @default '1e42-exchange'
     */
    bucket?: string;

    /**
     * Object name prefix scanned by the sync worker.
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
       * Artifacts larger than this are skipped entirely.
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
