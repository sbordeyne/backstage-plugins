import { SchedulerServiceTaskScheduleDefinitionConfig } from '@backstage/backend-plugin-api';

/** Which families of `metadata.links` are written onto ingested entities. */
interface GcpLinksConfig {
  /** Link to the resource in the GCP console. Defaults to `true`. */
  console?: boolean;

  /** Link to the product documentation for the resource type. Defaults to `true`. */
  docs?: boolean;

  /**
   * Link to a Logs Explorer query filtered to the resource. Defaults to `false`: the filter is an
   * assumption about how the resource logs, and a wrong one is worse than no link.
   */
  logs?: boolean;
}

/**
 * Which facts become `metadata.tags`. Every source defaults to `false`, so no entity grows tags
 * until one is turned on.
 */
interface GcpTagsConfig {
  /** Every GCP label as a `key-value` tag. */
  fromLabels?: boolean;

  /** Values of these label keys as bare tags, for the few labels worth searching on. */
  labelKeys?: string[];

  /** The entity's `spec.type`, e.g. `bucket`. */
  resourceType?: boolean;

  /** The resource's region. */
  region?: boolean;

  /** The project the resource lives in. */
  project?: boolean;

  /** Facts the provider knows about the resource: state, engine version, machine type. */
  attributes?: boolean;
}

/**
 * How IAM is read and how much of it reaches the catalog.
 *
 * IAM is what makes the catalog a graph rather than an inventory: the roles a service account holds
 * on resources become `dependsOn` relations on that account, so a Component pointing at a service
 * account reaches the database, secret and topic behind it.
 */
interface GcpIamConfig {
  /**
   * Whether IAM is read at all. Defaults to `true`; a project whose `cloudasset.googleapis.com` is
   * disabled simply contributes no edges, so leaving this on costs nothing.
   */
  enabled?: boolean;

  /**
   * Member kinds that produce edges: `serviceAccount`, `user`, `group`, `domain`, `public`.
   * Defaults to `[serviceAccount]` — those are the principals this module ingests entities for.
   */
  memberTypes?: string[];

  /** Only these roles produce edges. Defaults to every role. */
  roles?: string[];

  /** These roles never produce edges, e.g. noisy platform-agent grants. Defaults to `[]`. */
  excludeRoles?: string[];

  /**
   * Most resources one service account relates to. Defaults to `200`, which keeps a
   * broadly-granted account from burying its own entity page.
   */
  maxEdgesPerMember?: number;

  /** How long one project's policy sweep is reused. Defaults to `600` (10 minutes). */
  cacheTtlSeconds?: number;

  /** Most policy results read per project before the sweep stops. Defaults to `20000`. */
  maxBindingsPerProject?: number;

  /**
   * Whether each resource entity also carries a `cloud.google.com/iam-members` annotation naming
   * who holds roles on it. Defaults to `false`: the relations already answer this for principals
   * the catalog ingests, and this covers the rest at the cost of a wordy annotation.
   */
  annotateResources?: boolean;

  /**
   * Which relation vocabulary is emitted. Defaults to `builtin`.
   *
   * - `builtin` — every edge is `dependsOn` / `dependencyOf`, which is what the catalog and its
   *   graph views have always understood.
   * - `gcp` — IAM edges become the verb that the role actually grants (`accessorOf` / `accessedBy`,
   *   `publisherTo` / `publishedToBy`, `adminOf` / `administeredBy`, …), containment becomes
   *   `partOf` / `hasPart` and network attachment becomes `attachedTo` / `hasAttached`. Those edges
   *   are no longer `dependsOn`, so anything filtering on it — including some default Catalog Graph
   *   card configurations — stops showing them.
   */
  relations?: 'builtin' | 'gcp';
}

/** An extra link written onto every entity a provider ingests. */
interface GcpExtraLinkConfig {
  /**
   * Link target. Accepts the same `{{projectId}}` / `{{type}}` / `{{provider}}` / `{{region}}` /
   * `{{name}}` placeholders as `defaultNamespace`.
   */
  url: string;

  /** Link text shown on the entity page. */
  title?: string;

  /** Backstage icon key, e.g. `docs`, `dashboard`, `alert`. */
  icon?: string;

  /** Free-form grouping key, e.g. `runbook`. */
  type?: string;
}

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
   * Entity ref set as `spec.system` on resources that carry no system label, overriding
   * `defaultSystem`. When neither key is set, entities without the label carry no system.
   */
  system?: string;

  /**
   * GCP label read off each resource to find its system, overriding `systemLabel`.
   */
  systemLabel?: string;

  /**
   * Namespace template for this provider's entities, overriding `defaultNamespace`. See
   * `defaultNamespace` for the placeholders it may use.
   */
  namespace?: string;

  /**
   * Region recorded when the GCP API reports none for a resource, overriding `defaultRegion`.
   * When neither key is set, the region annotation is omitted rather than guessed.
   */
  region?: string;

  /**
   * Locations this provider is restricted to, e.g. `[europe-west1]`. Defaults to every location.
   *
   * Unlike `region`, which is a fallback value, this bounds the calls that would otherwise sweep
   * every zone and region of a project. A region also matches its zones, so `europe-west1` keeps
   * resources in `europe-west1-b`.
   */
  locations?: string[];

  /** Link families for this provider, overriding `links`. */
  links?: GcpLinksConfig;

  /** Tag sources for this provider, overriding `tags`. */
  tags?: GcpTagsConfig;

  /** Generated description fallback for this provider, overriding `descriptions`. */
  descriptions?: boolean;

  /** Extra links written onto every entity this provider ingests. */
  extraLinks?: GcpExtraLinkConfig[];

  /** Relation vocabulary for this provider, overriding `iam.relations`. */
  relations?: 'builtin' | 'gcp';
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

        /**
         * Default for every provider's `system`: the entity ref set as `spec.system` on resources
         * whose labels name no system. Falls back to omitting `spec.system`, since a resource that
         * belongs to no system is normal and an invented one would dangle.
         */
        defaultSystem?: string;

        /**
         * Default for every provider's `systemLabel`: the GCP label whose value names the system a
         * resource belongs to. Falls back to `backstage.io/system-ref`, matched under the same
         * spellings as `ownerLabel`. A bare value such as `payments` is read as a system in the
         * default namespace.
         */
        systemLabel?: string;

        /**
         * Default for every provider's `namespace`: the namespace ingested entities land in.
         * Falls back to `default`.
         *
         * The value is a template, in which `{{projectId}}`, `{{type}}`, `{{provider}}`, `{{region}}`
         * and `{{name}}` are replaced by the resource's project, its `spec.type`, the name of the
         * provider that ingested it, its region and its entity name. The result is lowercased with
         * anything outside `[a-z0-9-]` folded to `-`, so `gcp-{{projectId}}` gives `gcp-my-project`.
         *
         * Write `{{…}}`, not `${…}`: Backstage's config loader substitutes `${VAR}` with an
         * environment variable before this plugin sees it, and drops the whole key when the
         * variable is unset — so `gcp-${projectId}` silently yields no namespace template at all.
         * An existing `${…}` template can be escaped as `$${projectId}` instead.
         */
        defaultNamespace?: string;

        /** Default for every provider's `region`. Falls back to omitting the annotation. */
        defaultRegion?: string;

        /** Default for every provider's `links`. Console and documentation links are on. */
        links?: GcpLinksConfig;

        /** Default for every provider's `tags`. Every source is off. */
        tags?: GcpTagsConfig;

        /**
         * How IAM is read, shared by every provider. IAM edges are what turn the catalog into a
         * dependency graph — see the README's access graph section.
         */
        iam?: GcpIamConfig;

        /**
         * Default for every provider's `descriptions`: whether a resource whose API reports no
         * description of its own gets a generated one-liner. Defaults to `true`.
         */
        descriptions?: boolean;

        bigquery?: GcpProviderCommonConfig;
        clusters?: GcpProviderCommonConfig;
        cloudsql?: GcpProviderCommonConfig;
        secretmanager?: GcpProviderCommonConfig;
        'service-account'?: GcpProviderCommonConfig;
        storage?: GcpProviderCommonConfig;

        /**
         * Kubernetes service accounts discovered through Workload Identity, which are what a
         * Component depends on to reach the rest of the graph. Entity names are
         * `<poolProject>-<namespace>-<ksa>`.
         */
        'workload-identity'?: GcpProviderCommonConfig;

        'iam-roles'?: GcpProviderCommonConfig & {
          /**
           * Organization whose custom roles are ingested alongside the per-project ones, e.g.
           * `organizations/123456`. Defaults to project roles only.
           */
          organization?: string;
        };

        /** VPC networks. Peerings become relations on the network rather than entities. */
        vpc?: GcpProviderCommonConfig;

        /** Subnetworks. Entity names carry the region, since subnet names repeat across regions. */
        subnets?: GcpProviderCommonConfig;

        /** VPC firewall rules. A long-lived project can hold hundreds. */
        firewall?: GcpProviderCommonConfig;

        /** Cloud Routers, and the Cloud NAT gateways configured on them. */
        routers?: GcpProviderCommonConfig;

        /** Cloud DNS managed zones. */
        dns?: GcpProviderCommonConfig;

        /**
         * Cloud Load Balancing: forwarding rules, URL maps and backend services, related to each
         * other so a request path is walkable from the address inwards.
         */
        loadbalancers?: GcpProviderCommonConfig;

        /** Classic Compute SSL certificates. Certificate Manager has its own key. */
        sslcertificates?: GcpProviderCommonConfig;

        /** Cloud Armor security policies. */
        armor?: GcpProviderCommonConfig;

        /** Reserved IP addresses, regional and global. */
        addresses?: GcpProviderCommonConfig;

        /** Cloud VPN gateways and their tunnels. */
        vpn?: GcpProviderCommonConfig;

        /** Cloud Build triggers, linked to the repository they build. */
        cloudbuild?: GcpProviderCommonConfig;

        /** Cloud Deploy delivery pipelines and the targets they promote through. */
        clouddeploy?: GcpProviderCommonConfig;

        /** Workflows. */
        workflows?: GcpProviderCommonConfig;

        /** Cloud Composer environments. */
        composer?: GcpProviderCommonConfig;

        /** KMS key rings and the crypto keys on them. */
        kms?: GcpProviderCommonConfig;

        /** Certificate Manager certificates and maps, with their expiry dates. */
        certificatemanager?: GcpProviderCommonConfig;

        /** Binary Authorization policy and attestors. */
        binaryauthorization?: GcpProviderCommonConfig;

        alerts?: GcpProviderCommonConfig & {
          /** Whether uptime checks are ingested alongside the alert policies. Defaults to `true`. */
          includeUptimeChecks?: boolean;
        };

        /** Monitoring services and the SLOs defined on them. */
        slos?: GcpProviderCommonConfig;

        /** Log sinks, related to the bucket, dataset or topic they export to. */
        logsinks?: GcpProviderCommonConfig;

        /** Filestore instances. */
        filestore?: GcpProviderCommonConfig;

        /** Serverless VPC Access connectors, the hop between serverless workloads and a VPC. */
        vpcconnectors?: GcpProviderCommonConfig;

        /** Memorystore for Memcached instances. */
        memcache?: GcpProviderCommonConfig;

        /** App Engine services. Versions are not ingested — they accumulate indefinitely. */
        appengine?: GcpProviderCommonConfig;

        disks?: GcpProviderCommonConfig & {
          /**
           * Whether snapshots are ingested alongside the disks. Defaults to `false`: a daily backup
           * schedule produces a snapshot per disk per day.
           */
          includeSnapshots?: boolean;
        };

        /** BigQuery scheduled queries and transfers, related to the dataset they load. */
        bqtransfers?: GcpProviderCommonConfig;

        /** BigQuery slot reservations. */
        bqreservations?: GcpProviderCommonConfig;

        /** Analytics Hub exchanges and the listings published in them. */
        analyticshub?: GcpProviderCommonConfig;

        /** Datastream change-data-capture streams. */
        datastream?: GcpProviderCommonConfig;

        /** Dataplex lakes. */
        dataplex?: GcpProviderCommonConfig;

        dataflow?: GcpProviderCommonConfig & {
          /**
           * Job states to ingest, defaulting to `[JOB_STATE_RUNNING]`. A Dataflow job is one
           * execution, so ingesting terminated jobs means a new entity per run, forever.
           */
          states?: string[];
        };

        /**
         * Vertex AI endpoints and models. **`locations` is required**: the Vertex API is served
         * from regional hosts and has no cross-region listing, so without it nothing is ingested.
         */
        vertex?: GcpProviderCommonConfig;

        /** Vertex AI Workbench instances. */
        workbench?: GcpProviderCommonConfig;

        /**
         * Dataproc clusters. The API takes one region per call with no wildcard, so `locations` is
         * required in practice — without it only the `global` region is asked.
         */
        dataproc?: GcpProviderCommonConfig;

        /** Managed instance groups. */
        'instance-groups'?: GcpProviderCommonConfig;

        instances?: GcpProviderCommonConfig & {
          /**
           * Instance states to ingest, e.g. `[RUNNING]`. Defaults to every state.
           *
           * Instances churn faster than anything else in a GCP estate and every refresh applies a
           * full mutation, so narrowing this — and lengthening `schedule` — is what keeps an
           * autoscaled fleet from rewriting the catalog.
           */
          states?: string[];
        };

        /** Spanner instances and the databases on them. */
        spanner?: GcpProviderCommonConfig;

        /** Memorystore for Redis instances. */
        redis?: GcpProviderCommonConfig;

        /** AlloyDB clusters and their instances. */
        alloydb?: GcpProviderCommonConfig;

        /** Bigtable instances. */
        bigtable?: GcpProviderCommonConfig;

        /** Firestore databases. */
        firestore?: GcpProviderCommonConfig;

        /** Managed Service for Apache Kafka clusters and the topics on them. */
        managedkafka?: GcpProviderCommonConfig;

        /** Eventarc triggers, related to the topic they read and the service they deliver to. */
        eventarc?: GcpProviderCommonConfig;

        /** Cloud Tasks queues. */
        cloudtasks?: GcpProviderCommonConfig;

        /** Cloud Scheduler jobs, related to the Pub/Sub topic they publish to. */
        scheduler?: GcpProviderCommonConfig;

        /** Cloud Run services and jobs. */
        run?: GcpProviderCommonConfig;

        /** Cloud Functions, both generations. */
        functions?: GcpProviderCommonConfig;

        /** Artifact Registry repositories. */
        artifactregistry?: GcpProviderCommonConfig;

        images?: GcpProviderCommonConfig & {
          /**
           * Whether deprecated and obsolete images are ingested. Defaults to `false`, since old
           * image versions accumulate indefinitely.
           */
          includeDeprecated?: boolean;
        };

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
