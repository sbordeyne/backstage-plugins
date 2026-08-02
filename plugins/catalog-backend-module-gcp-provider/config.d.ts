import { SchedulerServiceTaskScheduleDefinitionConfig } from '@backstage/backend-plugin-api';

/** Settings shared by every GCP entity provider. */
interface GcpProviderCommonConfig {
  /**
   * Whether this provider runs at all. Defaults to `true`, so a provider is on as soon as its
   * config block exists; set it to `false` to stop ingesting this resource type while keeping the
   * block you would otherwise have to delete and restore.
   */
  enabled?: boolean;

  /** GCP projects to enumerate. */
  projects: string[];

  /** How often this provider refreshes. */
  schedule: SchedulerServiceTaskScheduleDefinitionConfig;

  /**
   * Entity ref set as `spec.owner` on resources that carry no owner label, overriding
   * `defaultOwner`. When neither key is set, such entities are owned by `unknown`.
   */
  owner?: string;

  /**
   * GCP label read off each resource to find its owner, overriding `ownerLabel`.
   */
  ownerLabel?: string;

  /**
   * Region recorded when the GCP API reports none for a resource, overriding `defaultRegion`.
   * When neither key is set, the region annotation is omitted rather than guessed.
   */
  region?: string;
}

export interface Config {
  catalog?: {
    providers?: {
      gcp?: {
        /** Default for every provider's `owner`. Falls back to `unknown`. */
        defaultOwner?: string;

        /**
         * Default for every provider's `ownerLabel`: the GCP label whose value names the entity
         * owning a resource. Falls back to `backstage.io/owner-ref`.
         *
         * GCP rejects label keys containing `.` or `/`, so the key is also matched with those
         * folded to underscores — the default is readable as `backstage_io_owner-ref` on an actual
         * resource. Values are restricted the same way, so they are usually a bare name such as
         * `platform-team`, read as a group in the default namespace.
         */
        ownerLabel?: string;

        /** Default for every provider's `region`. Falls back to omitting the annotation. */
        defaultRegion?: string;

        bigquery?: GcpProviderCommonConfig;
        clusters?: GcpProviderCommonConfig;
        cloudsql?: GcpProviderCommonConfig;
        secretmanager?: GcpProviderCommonConfig;
        'service-account'?: GcpProviderCommonConfig;
        storage?: GcpProviderCommonConfig;

        pubsub?: GcpProviderCommonConfig & {
          /**
           * Prefixes stripped from topic and subscription names before they become entity names,
           * applied repeatedly until none matches. Defaults to `[]`, leaving names as-is.
           */
          stripPrefixes?: string[];
        };
      };
    };
  };
}
