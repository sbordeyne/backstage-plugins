import { SchedulerServiceTaskScheduleDefinitionConfig } from '@backstage/backend-plugin-api';

/** Settings shared by every GCP entity provider. */
interface GcpProviderCommonConfig {
  /** GCP projects to enumerate. */
  projects: string[];

  /** How often this provider refreshes. */
  schedule: SchedulerServiceTaskScheduleDefinitionConfig;

  /**
   * Entity ref set as `spec.owner` on the resources this provider emits, overriding
   * `defaultOwner`. GCP exposes no ownership that maps onto a Backstage group, so nothing can be
   * inferred; when neither key is set, entities are owned by `unknown`.
   */
  owner?: string;

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
