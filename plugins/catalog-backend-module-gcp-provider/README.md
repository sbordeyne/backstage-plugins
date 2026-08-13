# @sbordeyne/plugin-catalog-backend-module-gcp-provider

Catalog backend module that ingests GCP resources as `Resource` entities and, from IAM, the edges
between them — so a microservice in the catalog can be walked down to the database, secret and topic
it actually depends on.

```
Component:auth
  └─ Resource:prod-auth-authsa          (kubernetes-service-account, via Workload Identity)
       ├─ Resource:prod-cluster         (kubernetes-cluster — where it can run)
       └─ Resource:auth-sa              (google-service-account — the identity it assumes)
            ├─ Resource:auth-db         (cloudsql-instance)      roles/cloudsql.client
            ├─ Resource:auth-jwks       (secret)                 roles/secretmanager.secretAccessor
            └─ Resource:auth-events     (pubsub-topic)           roles/pubsub.publisher
                 └─ Resource:audit-sa   (google-service-account) roles/pubsub.subscriber
                      └─ Component:audit
```

Every edge there except the two `Component` ones comes from IAM policy. See
[the access graph](#the-access-graph) for how to attach a Component to it.

| Config key         | Ingests                                  | `spec.type`                            |
| ------------------ | ---------------------------------------- | -------------------------------------- |
| `bigquery`         | BigQuery datasets                        | `bigquery-dataset`                     |
| `storage`          | Cloud Storage buckets                    | `bucket`                               |
| `cloudsql`         | Cloud SQL instances                      | `cloudsql-instance`                    |
| `pubsub`           | Pub/Sub topics and subscriptions         | `pubsub-topic`, `pubsub-subscription`  |
| `secretmanager`    | Secret Manager secrets                   | `secret`                               |
| `service-account`  | IAM service accounts                     | `google-service-account`               |
| `clusters`         | GKE clusters                             | `kubernetes-cluster`                   |
| `vpc`              | VPC networks, with peerings as relations | `vpc-network`                          |
| `subnets`          | Subnetworks                              | `subnetwork`                           |
| `firewall`         | Firewall rules                           | `firewall-rule`                        |
| `routers`          | Cloud Routers and their NAT gateways     | `cloud-router`, `cloud-nat`            |
| `dns`              | Cloud DNS managed zones                  | `dns-zone`                             |
| `instances`        | Compute Engine instances                 | `compute-instance`                     |
| `instance-groups`  | Managed instance groups                  | `instance-group`                       |
| `images`           | Custom Compute Engine images             | `compute-image`                        |
| `spanner`          | Spanner instances and databases          | `spanner-instance`, `spanner-database` |
| `redis`            | Memorystore for Redis instances          | `redis-instance`                       |
| `alloydb`          | AlloyDB clusters and instances           | `alloydb-cluster`, `alloydb-instance`  |
| `bigtable`         | Bigtable instances                       | `bigtable-instance`                    |
| `firestore`        | Firestore databases                      | `firestore-database`                   |
| `managedkafka`     | Managed Kafka clusters and topics        | `kafka-cluster`, `kafka-topic`         |
| `eventarc`         | Eventarc triggers                        | `eventarc-trigger`                     |
| `cloudtasks`       | Cloud Tasks queues                       | `cloud-tasks-queue`                    |
| `scheduler`        | Cloud Scheduler jobs                     | `scheduler-job`                        |
| `run`              | Cloud Run services and jobs              | `cloud-run-service`, `cloud-run-job`   |
| `functions`        | Cloud Functions, both generations        | `cloud-function`                       |
| `artifactregistry` | Artifact Registry repositories           | `artifact-repository`                  |

IAM, load balancing, CI/CD, security, observability and the data platform:

| Config key            | Ingests                                      | `spec.type`                                       |
| --------------------- | -------------------------------------------- | ------------------------------------------------- |
| `workload-identity`   | Kubernetes accounts bound to Google ones     | `kubernetes-service-account`                      |
| `iam-roles`           | Custom IAM roles                             | `iam-role`                                        |
| `loadbalancers`       | Forwarding rules, URL maps, backend services | `load-balancer`, `url-map`, `backend-service`     |
| `sslcertificates`     | Compute SSL certificates                     | `ssl-certificate`                                 |
| `armor`               | Cloud Armor policies                         | `security-policy`                                 |
| `addresses`           | Reserved IP addresses                        | `ip-address`                                      |
| `vpn`                 | VPN gateways and tunnels                     | `vpn-gateway`, `vpn-tunnel`                       |
| `cloudbuild`          | Build triggers                               | `build-trigger`                                   |
| `clouddeploy`         | Delivery pipelines and targets               | `delivery-pipeline`, `deploy-target`              |
| `workflows`           | Workflows                                    | `workflow`                                        |
| `composer`            | Composer environments                        | `composer-environment`                            |
| `dataproc`            | Dataproc clusters                            | `dataproc-cluster`                                |
| `kms`                 | KMS key rings and keys                       | `kms-key-ring`, `kms-key`                         |
| `certificatemanager`  | Certificate Manager certificates and maps    | `certificate`, `certificate-map`                  |
| `binaryauthorization` | Binary Authorization policy and attestors    | `binauthz-policy`, `binauthz-attestor`            |
| `alerts`              | Alert policies and uptime checks             | `alert-policy`, `uptime-check`                    |
| `slos`                | Monitoring services and SLOs                 | `monitoring-service`, `slo`                       |
| `logsinks`            | Log sinks                                    | `log-sink`                                        |
| `filestore`           | Filestore instances                          | `filestore-instance`                              |
| `vpcconnectors`       | Serverless VPC Access connectors             | `vpc-connector`                                   |
| `memcache`            | Memorystore for Memcached                    | `memcache-instance`                               |
| `appengine`           | App Engine services                          | `appengine-service`                               |
| `disks`               | Persistent disks and snapshots               | `disk`, `snapshot`                                |
| `bqtransfers`         | BigQuery transfers and scheduled queries     | `bigquery-transfer`                               |
| `bqreservations`      | BigQuery slot reservations                   | `bigquery-reservation`                            |
| `analyticshub`        | Analytics Hub exchanges and listings         | `analytics-hub-exchange`, `analytics-hub-listing` |
| `datastream`          | Datastream streams                           | `datastream-stream`                               |
| `dataplex`            | Dataplex lakes                               | `dataplex-lake`                                   |
| `dataflow`            | Dataflow jobs                                | `dataflow-job`                                    |
| `vertex`              | Vertex endpoints and models                  | `vertex-endpoint`, `vertex-model`                 |
| `workbench`           | Vertex AI Workbench instances                | `workbench-instance`                              |

Three of these are worth narrowing before enabling: `instances` and `disks` churn constantly, and
`dataflow` creates an entity per job execution unless `states` limits it. `vertex` **requires
`locations`** — its API is served from regional hosts with no cross-region listing.

Each provider needs its API enabled in every project it enumerates. A project whose API is off, or
that the credentials cannot read, is logged and skipped rather than failing the whole refresh.

## Installation

```ts
// packages/backend/src/index.ts
backend.add(import('@sbordeyne/plugin-catalog-backend-module-gcp-provider'));
```

Authentication uses Application Default Credentials. Set `GOOGLE_APPLICATION_CREDENTIALS` to a
service account key file, or rely on the ambient credentials of the environment.

## Configuration

Each provider is enabled by the presence of its config key under `catalog.providers.gcp`. Every
provider takes a `projects` list and a `schedule` block, and accepts the optional `enabled`, `owner`,
`system`, `namespace`, `region`, `locations`, `links`, `tags`, `descriptions` and `extraLinks`
described below.

`enabled` defaults to `true`, so a provider runs as soon as its block exists. Setting it to `false`
stops that resource type from being ingested without deleting the configuration you would have to
put back to turn it on again.

```yaml
catalog:
  providers:
    gcp:
      # Applied to every provider below unless it sets its own
      # `owner` / `ownerLabel` / `system` / `systemLabel` / `namespace` / `region`.
      defaultOwner: group:default/platform
      defaultRegion: europe-west1
      # Label read off each resource to find its owner.
      # Defaults to 'backstage.io/owner-ref'.
      ownerLabel: backstage.io/owner-ref
      # Label read off each resource to find the system it belongs to.
      # Defaults to 'backstage.io/system-ref'.
      systemLabel: backstage.io/system-ref
      # System for resources whose labels name none. Omitted by default.
      defaultSystem: system:default/infrastructure
      # Namespace template for every ingested entity. Defaults to 'default'.
      defaultNamespace: gcp-${projectId}
      # Link families written onto every entity.
      links:
        console: true # default
        docs: true # default
        logs: false # default
      # Tag sources. Every one defaults to false.
      tags:
        fromLabels: true
      # Generated description when the API reports none. Defaults to true.
      descriptions: true

      service-account:
        projects: [my-project]
        schedule:
          frequency: { hours: 1 }
          timeout: { minutes: 10 }
      bigquery:
        projects: [my-project]
        schedule: { frequency: { hours: 1 }, timeout: { minutes: 10 } }
      pubsub:
        projects: [my-project]
        # Pub/Sub resources belong to a different team than the rest.
        owner: group:default/back-end
        # Prefixes stripped from topic and subscription names before they become
        # entity names. Applied repeatedly until no prefix matches, so
        # 'myorg-prod-orders' with ['myorg-', 'prod-'] becomes 'orders'.
        # Defaults to [] — names are used as-is.
        stripPrefixes: ['myorg-', 'prod-', 'preprod-']
        schedule: { frequency: { hours: 1 }, timeout: { minutes: 10 } }
      cloudsql:
        projects: [my-project]
        # Databases are kept apart from the rest of the catalog.
        namespace: databases-${projectId}
        schedule: { frequency: { hours: 1 }, timeout: { minutes: 10 } }
      storage:
        projects: [my-project]
        schedule: { frequency: { hours: 1 }, timeout: { minutes: 10 } }
      secretmanager:
        projects: [my-project]
        schedule: { frequency: { hours: 1 }, timeout: { minutes: 10 } }
      clusters:
        # Kept configured, but not ingested for now.
        enabled: false
        projects: [my-project]
        schedule: { frequency: { hours: 1 }, timeout: { minutes: 10 } }

      vpc:
        projects: [my-project]
        schedule: { frequency: { hours: 6 }, timeout: { minutes: 10 } }
      subnets:
        projects: [my-project]
        # Only sweep the regions actually in use.
        locations: [europe-west1, europe-west9]
        schedule: { frequency: { hours: 6 }, timeout: { minutes: 10 } }
      instances:
        projects: [my-project]
        # Instances churn, and each refresh rewrites the whole set — ingest the
        # long-lived ones on a slower schedule than the rest.
        states: [RUNNING]
        schedule: { frequency: { hours: 6 }, timeout: { minutes: 15 } }
      images:
        projects: [my-project]
        # Old image versions accumulate; off by default.
        includeDeprecated: false
        schedule: { frequency: { hours: 12 }, timeout: { minutes: 10 } }
      spanner:
        projects: [my-project]
        extraLinks:
          - title: Runbook
            url: https://wiki.example.com/db/${name}
            icon: docs
        schedule: { frequency: { hours: 6 }, timeout: { minutes: 10 } }
      run:
        projects: [my-project]
        schedule: { frequency: { hours: 1 }, timeout: { minutes: 10 } }
      eventarc:
        projects: [my-project]
        schedule: { frequency: { hours: 6 }, timeout: { minutes: 10 } }
```

### Ownership

`spec.owner` is taken from a label on the GCP resource itself, so a team that relabels a resource
moves it in the catalog without anyone editing Backstage config. The label key is `ownerLabel`,
defaulting to `backstage.io/owner-ref`, and is resolved per provider as `ownerLabel` →
`catalog.providers.gcp.ownerLabel` → the default.

Two GCP restrictions shape how the label is written:

- **Keys** must match `[a-z]([-a-z0-9_]{0,62})?`, so `backstage.io/owner-ref` cannot be set on a
  resource at all. The key is therefore also matched with `.` and `/` folded to underscores, and
  the label you actually put on a resource is `backstage_io_owner-ref`. Configure `ownerLabel`
  directly if you prefer a plain key such as `backstage-owner-ref`.
- **Values** are restricted the same way, so a full entity ref does not fit. A bare value like
  `platform-team` is read as `group:default/platform-team`. A value that does name a kind or
  namespace is parsed as the ref it already is.

```bash
gcloud storage buckets update gs://my-bucket \
  --update-labels=backstage_io_owner-ref=platform-team
```

A resource with no such label — and every IAM service account, since those carry no labels at all —
falls back to `owner` → `defaultOwner` → `unknown`. The `unknown` fallback is a valid ref, so the
catalog still accepts the entities, and an obviously wrong one, so unlabelled resources are visible
instead of silently misfiled. A label whose value is not a usable entity ref is logged and treated
as absent, rather than emitting an entity the catalog would reject.

### Systems

`spec.system` works the same way as the owner: it is read from a label on the resource, under the
key `systemLabel` → `catalog.providers.gcp.systemLabel` → `backstage.io/system-ref`, with the same
two GCP restrictions. The label you put on a resource is therefore `backstage_io_system-ref`, and a
bare value such as `payments` is read as `system:default/payments`.

```bash
gcloud storage buckets update gs://my-bucket \
  --update-labels=backstage_io_system-ref=payments
```

A resource whose labels name no system falls back to `system` → `defaultSystem`. Unlike the owner
there is no catch-all: when neither key is set, `spec.system` is left off entirely, because a
resource that belongs to no system is a normal thing to have and an invented one would be a ref
pointing at nothing. A label whose value is not a usable ref is logged and treated as absent.

### Namespaces

Every ingested entity lands in the namespace given by `namespace` → `defaultNamespace` → `default`,
which is a template over the resource being ingested:

| Placeholder    | Value                                                    |
| -------------- | -------------------------------------------------------- |
| `${projectId}` | GCP project the resource lives in                        |
| `${type}`      | `spec.type` of the entity, e.g. `bucket`, `pubsub-topic` |
| `${provider}`  | Provider that ingested it, e.g. `gcp-bucket`             |
| `${region}`    | Region or location, empty when the API reported none     |
| `${name}`      | Entity name of the resource                              |

The rendered value is lowercased with anything outside `[a-z0-9-]` folded to `-` and truncated to
63 characters, so `gcp-${projectId}` becomes `gcp-my-project` and `${provider}` becomes
`gcp-bucket`. A template naming an unknown placeholder is logged and ignored, and its entities land
in `default` — visibly wrong, but still ingested.

Relations between entities follow the namespaces: each ref is built from the namespace of the
provider that ingests the target, so namespacing providers differently keeps them resolving.

`locations` narrows the sweep for providers that would otherwise ask about every region — the
aggregated Compute listings and the `locations/-` listings. It is not the same key as `region`,
which is the fallback recorded when the API reports no location at all. A region also matches its
zones, so `europe-west1` keeps an instance in `europe-west1-b`.

## The access graph

IAM is what turns the catalog from an inventory into something walkable. Every role a service
account holds on a resource becomes a `dependsOn` relation **on the service account entity**, and
because Backstage derives the reverse relation automatically, the bucket, database and topic each
gain their `dependencyOf` edge without their own providers doing anything.

Policies are read through **Cloud Asset Inventory**: one `searchAllIamPolicies` call per project
covers every resource in it, cached and shared by every provider. Enable `cloudasset.googleapis.com`
and grant `roles/cloudasset.viewer`; without them, everything still ingests and the graph is simply
flat.

### Attaching a Component

A Google service account reached through GKE has a Kubernetes service account bound to it by
Workload Identity, and the `workload-identity` provider ingests that binding as an entity. It is
what a Component attaches to, and its name is deterministic —
`<poolProject>-<k8sNamespace>-<ksaName>`:

```yaml
# catalog-info.yaml, in the auth service's own repo
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: auth
spec:
  type: service
  owner: group:default/platform
  dependsOn:
    - resource:gcp-prod/prod-auth-auth-sa # <poolProject>-<namespace>-<ksa>
```

That single line connects the Component to the whole chain in the diagram at the top of this file.
No cluster credentials are involved: the binding is discovered from the Google service account's own
IAM policy, where members are written `serviceAccount:PROJECT.svc.id.goog[namespace/ksa]`.

A Kubernetes account bound to several Google accounts is one entity depending on each of them, and
it relates to every Workload-Identity-enabled cluster in the pool's project — the pool is
project-scoped, so naming one cluster would be a guess.

### What IAM does not give you

**Project-level grants produce no edges.** A service account holding `roles/editor` on the project
can reach everything and names nothing, so there is no resource to point at. Those roles are
recorded on the account as `cloud.google.com/iam-project-roles` instead. A project managed largely
through project-level grants therefore produces a sparse graph — which is a fact about the estate
worth knowing.

**Edges only exist for accounts that are ingested.** Keep the `service-account` provider enabled;
a service account from an unconfigured project holding a role on your bucket produces nothing.
Setting `iam.annotateResources: true` adds a `cloud.google.com/iam-members` annotation to each
resource for that audit view.

**Bindings are not entities.** One entity per (resource, role) would multiply the catalog several
times over on the fastest-changing data in GCP, and put an extra hop in every path. The role is kept
on the account, in `cloud.google.com/iam-roles` and `cloud.google.com/iam-access`.

```yaml
catalog:
  providers:
    gcp:
      iam:
        enabled: true # default
        memberTypes: [serviceAccount] # default; add user or group for human grants
        excludeRoles: [roles/viewer] # noisy blanket grants
        maxEdgesPerMember: 200 # default
        annotateResources: false # default
```

### Relation vocabulary

By default every edge is `dependsOn` / `dependencyOf`, which is what the catalog and its graph views
have always understood. Setting `iam.relations: gcp` names each edge after what it actually is:

```yaml
catalog:
  providers:
    gcp:
      iam:
        relations: gcp # builtin (default) | gcp
```

IAM edges take the verb the role grants, classified by role suffix so a role this module has never
heard of still lands somewhere sensible:

| Role                                         | On the service account | On the resource  |
| -------------------------------------------- | ---------------------- | ---------------- |
| `roles/pubsub.publisher`                     | `publisherTo`          | `publishedToBy`  |
| `roles/pubsub.subscriber`                    | `subscriberOf`         | `subscribedBy`   |
| `roles/run.invoker`                          | `invokerOf`            | `invokedBy`      |
| `roles/cloudsql.client`                      | `clientOf`             | `connectedToBy`  |
| `roles/cloudkms.cryptoKeyEncrypter…`         | `encrypterOf`          | `encryptedBy`    |
| `roles/secretmanager.secretAccessor`         | `accessorOf`           | `accessedBy`     |
| anything `.admin` or `.owner`                | `adminOf`              | `administeredBy` |
| anything `.editor`, `.writer`, `.dataEditor` | `writerOf`             | `writtenBy`      |
| anything `.viewer` or `.reader`              | `readerOf`             | `readBy`         |
| anything else                                | `userOf`               | `usedBy`         |

An account holding several roles on one resource gets **one** relation, the strongest: `adminOf` and
`readerOf` on the same bucket says nothing that `adminOf` does not.

Structural edges are typed too. Containment reuses Backstage's own `partOf` / `hasPart` — a Spanner
database really is part of its instance — and attachment gets a pair of its own, because a GKE
cluster is plugged into its subnet rather than being part of it:

| Edge                                                    | In `gcp` mode                |
| ------------------------------------------------------- | ---------------------------- |
| Spanner database → instance, AlloyDB instance → cluster | `partOf` / `hasPart`         |
| Kafka topic → cluster, KMS key → ring, SLO → service    | `partOf` / `hasPart`         |
| Cloud NAT → router, Analytics Hub listing → exchange    | `partOf` / `hasPart`         |
| GKE cluster, VM, Composer, Dataproc → VPC or subnet     | `attachedTo` / `hasAttached` |
| Redis, Memcached, Filestore, VPC connector → VPC        | `attachedTo` / `hasAttached` |
| VPC → its peers, subnet and firewall rule → VPC         | `attachedTo` / `hasAttached` |

Everything else — a scheduler job and its topic, a log sink and its destination, a load balancer and
its backends — stays `dependsOn`, because that is what those genuinely are.

**The trade.** These types have no spec field to live in, so they are emitted by a `CatalogProcessor`
the module registers. That is the supported way to add relation types, and it means the edges no
longer appear as `dependsOn`: anything filtering on it, including some default Catalog Graph card
configurations, stops showing them. Check your entity page's graph card before switching an existing
installation over.

### Relations

Providers relate their entities to the resources GCP says they depend on, provided the target's own
provider is configured:

| From                            | Depends on                                                         |
| ------------------------------- | ------------------------------------------------------------------ |
| Subnet, firewall rule, router   | its VPC network                                                    |
| VPC network                     | the networks it is peered with                                     |
| Cloud NAT                       | its Cloud Router                                                   |
| Compute instance                | its subnet and its service accounts                                |
| Redis, AlloyDB cluster          | the VPC they are attached to                                       |
| Kafka cluster                   | the subnets its brokers are reachable through                      |
| Spanner / AlloyDB / Kafka child | its instance, cluster or topic parent                              |
| Pub/Sub subscription            | its topic                                                          |
| Eventarc trigger                | its Pub/Sub topic; it is a dependency of its Cloud Run destination |
| Scheduler job, Cloud Function   | the Pub/Sub topic it publishes to or reads                         |
| Cloud Run, Functions, Workflows | the service account it runs as, and its VPC connector              |
| Kubernetes service account      | the Google account it impersonates, and its GKE clusters           |
| Google service account          | every resource it holds a resource-level role on                   |
| GKE cluster                     | its VPC and subnet                                                 |
| Cloud SQL instance              | the VPC it is peered with, when it has a private address           |
| Load balancer                   | its URL map → backend services → instance groups                   |
| Delivery pipeline               | its deploy targets → the GKE cluster they deploy to                |
| Build trigger                   | the service account the build runs as                              |
| KMS key                         | its key ring                                                       |
| Log sink                        | the bucket, dataset or topic it exports to                         |
| SLO                             | its Monitoring service → the Cloud Run service behind it           |
| BigQuery transfer               | the dataset it loads into                                          |
| Analytics Hub listing           | its exchange and the dataset it publishes                          |

Refs to Pub/Sub topics apply the same `stripPrefixes` the `pubsub` provider does, so a topic
ingested as `orders` is still found by a trigger that names it `myorg-orders`.

### Region

Not every API reports a location for every resource. The region is resolved as the value the API
returned → this provider's `region` → `defaultRegion`. If none of those yields a value, the
`cloud.google.com/region` annotation is left off rather than filled with a guess.

## Labels

Every GCP label on a resource is copied onto the entity as a Backstage label, so the catalog can be
filtered on the same vocabulary teams already tag their infrastructure with. This includes the owner
and system labels, which stay visible on the entity rather than only being consumed.

Labels the catalog would reject are dropped rather than mangled: an empty value, or a key or value
outside `[a-zA-Z0-9]([-a-zA-Z0-9_.]{0,61}[a-zA-Z0-9])?` (keys may carry one `prefix/` segment).
GCP's own label rules are stricter than this, so labels set through GCP always survive.

## Titles, descriptions and links

`metadata.title` is the display name the API reports, or the GCP name whenever normalizing it into
an entity name changed it — a bucket ingested as `my-bucket-name` still shows the `My_Bucket.Name`
you would search the console for.

`metadata.description` is the resource's own description where the API has one, and otherwise a
generated one-liner: `POSTGRES_15 instance in europe-west1`, `Delivers
google.cloud.pubsub.topic.v1.messagePublished to Cloud Run service orders-api`. Set
`descriptions: false` to leave entities without a description instead.

`metadata.links` carries up to four families, resolved per key as `links.<family>` →
`catalog.providers.gcp.links.<family>` → the default:

| Family    | Link                                                   | Default |
| --------- | ------------------------------------------------------ | ------- |
| `console` | the resource in the GCP console                        | on      |
| `docs`    | the product documentation for its type                 | on      |
| `logs`    | a Logs Explorer query filtered to the resource         | off     |
| —         | resource-specific: a Cloud Run service or function URL | always  |

`logs` is off because the filter is an assumption about how the resource logs, and a link to a
query returning nothing is worse than no link. `extraLinks` adds links of your own, with the same
`${projectId}` / `${type}` / `${provider}` / `${region}` / `${name}` placeholders as the namespace
template:

```yaml
extraLinks:
  - title: Runbook
    url: https://wiki.example.com/db/${name}
    icon: docs
    type: runbook
```

## Tags

`metadata.tags` is off entirely by default — an existing catalog should not sprout tags on upgrade —
and each source is enabled independently:

```yaml
tags:
  fromLabels: false # every GCP label as a `key-value` tag
  labelKeys: [] # values of these label keys, as bare tags
  resourceType: false # the entity's spec.type
  region: false
  project: false
  attributes: false # state, engine version, machine type, tier
```

Values are lowercased with anything outside `[a-z0-9+#]` folded to `-`, deduplicated, and capped at
25 tags per entity so a heavily labelled resource cannot bury its own entity page.

## Annotations

Ingested entities carry the following annotations:

| Annotation                         | Meaning                                           |
| ---------------------------------- | ------------------------------------------------- |
| `cloud.google.com/project-id`      | GCP project owning the resource                   |
| `cloud.google.com/region`          | Region, zone or location of the resource          |
| `cloud.google.com/self-link`       | Canonical GCP URL of the resource                 |
| `cloud.google.com/service-account` | Service account email                             |
| `cloud.google.com/status`          | State the API reports, e.g. `RUNNING`, `READY`    |
| `cloud.google.com/vpc-peerings`    | Names of the peerings configured on a VPC network |
| `cloud.google.com/machine-type`    | Machine type of a Compute Engine instance         |

Resource types add their own on top: `cloud.google.com/ip-cidr-range` on a subnet,
`cloud.google.com/dns-name` on a DNS zone, `cloud.google.com/schedule` on a Scheduler job,
`cloud.google.com/registry-uri` on an Artifact Registry repository, and so on.

`cloud.google.com/self-link` is the `selfLink` the API reported. The APIs that report none — Secret
Manager, Pub/Sub, IAM and every `projects/…/locations/…` service — get the canonical REST URL of the
resource instead, which is the same URL the API would have returned.
