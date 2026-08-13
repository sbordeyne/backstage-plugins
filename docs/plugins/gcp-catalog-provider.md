# GCP catalog provider

`@sbordeyne/plugin-catalog-backend-module-gcp-provider`

A catalog backend module that ingests Google Cloud resources as `Resource` entities and, from IAM,
the edges between them. Fifty-nine providers ship in the module, each enabled independently by its
own config block, each on its own schedule.

The point of the edges is this: a Component that names one Kubernetes service account can be walked
down to everything it reaches.

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

See [the access graph](#the-access-graph) for how that is built and what it costs.

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

IAM, load balancing, CI/CD, security, observability, the data platform and ML:

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

Entities land in the namespace given by the `namespace` template, which defaults to `default`.
Each provider needs its API enabled in the projects it enumerates; a project whose API is off, or
that the credentials cannot read, is logged and skipped rather than failing the refresh.

## Installation

```bash
yarn --cwd packages/backend add @sbordeyne/plugin-catalog-backend-module-gcp-provider
```

```ts
// packages/backend/src/index.ts
backend.add(import('@backstage/plugin-catalog-backend'));
backend.add(import('@sbordeyne/plugin-catalog-backend-module-gcp-provider'));
```

The module registers nothing at all when `catalog.providers.gcp` is absent, so installing it
before configuring it is harmless.

## Authentication

Credentials come from Application Default Credentials. Two paths work:

- **`GOOGLE_APPLICATION_CREDENTIALS`** pointing at a service account key file. The module reads
  and parses the file itself and passes the parsed credentials to every Google client.
- **Ambient credentials** — Workload Identity on GKE, the attached service account on a GCE VM
  or Cloud Run, or `gcloud auth application-default login` in development. Leave
  `GOOGLE_APPLICATION_CREDENTIALS` unset and the clients resolve credentials themselves.

Workload Identity is the option to prefer in production: it removes the key file entirely. See
[GCP permissions](../guides/gcp-permissions.md) for the roles each provider needs and how to
grant them.

## Configuration

```yaml
catalog:
  providers:
    gcp:
      # Applied to every provider below unless it sets its own value.
      defaultOwner: group:default/platform
      defaultRegion: europe-west1
      ownerLabel: backstage.io/owner-ref
      systemLabel: backstage.io/system-ref
      # Every entity of a project lands together.
      defaultNamespace: gcp-${projectId}

      service-account:
        projects: [my-project]
        schedule:
          frequency: { hours: 1 }
          timeout: { minutes: 10 }

      bigquery:
        projects: [my-project, my-other-project]
        schedule: { frequency: { hours: 1 }, timeout: { minutes: 10 } }

      pubsub:
        projects: [my-project]
        # Pub/Sub resources belong to a different team than the rest.
        owner: group:default/back-end
        # Prefixes stripped from topic and subscription names before they become entity
        # names. Applied repeatedly until no prefix matches, so 'myorg-prod-orders' with
        # ['myorg-', 'prod-'] becomes 'orders'. Defaults to [] — names are used as-is.
        stripPrefixes: ['myorg-', 'prod-', 'preprod-']
        schedule: { frequency: { hours: 1 }, timeout: { minutes: 10 } }

      cloudsql:
        projects: [my-project]
        schedule: { frequency: { hours: 1 }, timeout: { minutes: 10 } }

      storage:
        projects: [my-project]
        schedule: { frequency: { hours: 6 }, timeout: { minutes: 15 } }

      secretmanager:
        projects: [my-project]
        schedule: { frequency: { hours: 6 }, timeout: { minutes: 10 } }

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
        # Only the regions actually in use, rather than every region GCP has.
        locations: [europe-west1, europe-west9]
        schedule: { frequency: { hours: 6 }, timeout: { minutes: 10 } }

      instances:
        projects: [my-project]
        # Instances churn and each refresh rewrites the whole set; narrow and slow it down.
        states: [RUNNING]
        schedule: { frequency: { hours: 6 }, timeout: { minutes: 15 } }

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

### Shared keys

Set once under `catalog.providers.gcp` and inherited by every provider.

| Key                | Type    | Default                   | Meaning                                           |
| ------------------ | ------- | ------------------------- | ------------------------------------------------- |
| `defaultOwner`     | string  | `unknown`                 | `spec.owner` for resources whose label names none |
| `ownerLabel`       | string  | `backstage.io/owner-ref`  | Label read off a resource to find its owner       |
| `defaultSystem`    | string  | _`spec.system` omitted_   | System for resources whose label names none       |
| `systemLabel`      | string  | `backstage.io/system-ref` | Label read off a resource to find its system      |
| `defaultNamespace` | string  | `default`                 | Namespace template for ingested entities          |
| `defaultRegion`    | string  | _annotation omitted_      | Region used when the GCP API reports none         |
| `links`            | object  | console and docs on       | Which `metadata.links` families are written       |
| `tags`             | object  | every source off          | Which facts become `metadata.tags`                |
| `descriptions`     | boolean | `true`                    | Generated description when the API reports none   |

The namespace template accepts `${projectId}`, `${type}`, `${provider}`, `${region}` and `${name}`,
so `gcp-${projectId}` puts every entity of a project together. The rendered value is lowercased
with anything outside `[a-z0-9-]` folded to `-`.

### Per-provider keys

Accepted inside each provider block. `owner`, `ownerLabel`, `system`, `systemLabel`, `namespace`,
`region`, `links`, `tags` and `descriptions` override the shared value for that provider only.

| Key                 | Type     | Default      | Meaning                                                               |
| ------------------- | -------- | ------------ | --------------------------------------------------------------------- |
| `projects`          | string[] | **required** | GCP projects to enumerate                                             |
| `schedule`          | object   | **required** | Standard Backstage task schedule (`frequency`, `timeout`, …)          |
| `enabled`           | boolean  | `true`       | Set `false` to stop ingesting without deleting the block              |
| `owner`             | string   | inherited    | Owner for resources with no owner label                               |
| `system`            | string   | inherited    | System for resources with no system label                             |
| `namespace`         | string   | inherited    | Namespace template for this provider's entities                       |
| `region`            | string   | inherited    | Region used when the API reports none                                 |
| `locations`         | string[] | all          | Bounds the regions and zones this provider asks about                 |
| `extraLinks`        | object[] | `[]`         | Extra `{url, title, icon, type}` links, templated like `namespace`    |
| `stripPrefixes`     | string[] | `[]`         | **`pubsub` only.** Prefixes removed from topic and subscription names |
| `states`            | string[] | all          | **`instances` only.** Instance states to ingest, e.g. `[RUNNING]`     |
| `includeDeprecated` | boolean  | `false`      | **`images` only.** Whether deprecated images are ingested             |

`locations` is not `region`: it narrows which regions and zones are asked about, where `region` is
the fallback recorded when the API reports no location at all. A region matches its zones, so
`europe-west1` keeps an instance in `europe-west1-b`.

### Turning a provider off

`enabled` defaults to `true`, so a provider runs as soon as its block exists. Setting it to
`false` stops that resource type from being ingested while keeping the configuration you would
otherwise have to delete and put back:

```yaml
catalog:
  providers:
    gcp:
      clusters:
        enabled: false
        projects: [my-project]
        schedule: { frequency: { hours: 1 }, timeout: { minutes: 10 } }
```

The check runs before the provider is constructed, so a disabled provider builds no GCP client
and schedules no refresh task.

## Ownership

`spec.owner` is taken from a label on the GCP resource itself, so a team that relabels a
resource moves it in the catalog without anyone editing Backstage config. The label key is
`ownerLabel`, defaulting to `backstage.io/owner-ref`.

Two GCP restrictions shape how the label is written:

- **Keys** must match `[a-z]([-a-z0-9_]{0,62})?`, so `backstage.io/owner-ref` cannot be set on
  a resource at all. The key is therefore also matched with `.` and `/` folded to underscores,
  and the label you actually put on a resource is `backstage_io_owner-ref`. Configure
  `ownerLabel` directly if you prefer a plain key such as `backstage-owner-ref`.
- **Values** are restricted the same way, so a full entity ref does not fit. A bare value like
  `platform-team` is read as `group:default/platform-team`. A value that does name a kind or
  namespace is parsed as the ref it already is.

```bash
# Cloud Storage
gcloud storage buckets update gs://my-bucket \
  --update-labels=backstage_io_owner-ref=platform-team

# Cloud SQL
gcloud sql instances patch my-instance \
  --update-labels=backstage_io_owner-ref=platform-team

# Pub/Sub
gcloud pubsub topics update my-topic \
  --update-labels=backstage_io_owner-ref=platform-team

# GKE
gcloud container clusters update my-cluster --region=europe-west1 \
  --update-labels=backstage_io_owner-ref=platform-team
```

In Terraform the label goes on the resource the same way:

```hcl
resource "google_storage_bucket" "reports" {
  name     = "my-bucket"
  location = "EU"

  labels = {
    "backstage_io_owner-ref" = "platform-team"
  }
}
```

Where the label is read from, per resource type:

| Provider                                                           | Label source                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------- |
| `bigquery`                                                         | dataset metadata labels                                 |
| `storage`                                                          | bucket metadata labels                                  |
| `cloudsql`                                                         | `settings.userLabels`                                   |
| `clusters`                                                         | `resourceLabels`                                        |
| `pubsub`                                                           | topic and subscription metadata labels                  |
| `secretmanager`                                                    | secret labels                                           |
| `instances`, `images`, `dns`                                       | resource labels                                         |
| `spanner`, `redis`, `alloydb`, `bigtable`                          | instance or cluster labels                              |
| `managedkafka`, `eventarc`, `run`, `functions`, `artifactregistry` | resource labels                                         |
| `service-account`                                                  | **none** — IAM service accounts carry no labels         |
| `vpc`, `subnets`, `firewall`, `routers`, `instance-groups`         | **none** — the Compute API has no label field for these |

The same mechanism sets `spec.system` from `systemLabel`, defaulting to `backstage.io/system-ref`
and written on a resource as `backstage_io_system-ref`. A resource whose labels name no system
falls back to `system` → `defaultSystem`, and to omitting `spec.system` when neither is set.

A resource with no such label falls back to `owner` → `defaultOwner` → `unknown`. The `unknown`
fallback is a valid ref, so the catalog still accepts the entity, and an obviously wrong one, so
unlabelled resources are visible instead of silently misfiled. A label whose value is not a
usable entity ref is logged and treated as absent, rather than emitting an entity the catalog
would reject and failing the whole project's ingestion with it.

## Region

Not every API reports a location for every resource. The region is resolved as the value the
API returned → this provider's `region` → `defaultRegion`. If none of those yields a value the
`cloud.google.com/region` annotation is left off rather than filled with a guess.

## Metadata

Beyond the name and namespace, every entity carries:

- **`title`** — the API's display name, or the GCP name when normalizing it into an entity name
  changed it, so `My_Bucket.Name` stays visible on the entity ingested as `my-bucket-name`.
- **`description`** — the resource's own description, or a generated one-liner such as
  `POSTGRES_15 instance in europe-west1`. Turn the fallback off with `descriptions: false`.
- **`labels`** — every GCP label the resource carries, minus any the catalog would reject.
- **`links`** — a console link and a documentation link by default, a Logs Explorer link under
  `links.logs: true`, the service URL for Cloud Run and Cloud Functions, and anything configured
  in `extraLinks`.
- **`tags`** — nothing at all unless a source is enabled under `tags`.

## Annotations

| Annotation                         | Meaning                                           |
| ---------------------------------- | ------------------------------------------------- |
| `cloud.google.com/project-id`      | GCP project owning the resource                   |
| `cloud.google.com/region`          | Region, zone or location of the resource          |
| `cloud.google.com/self-link`       | Canonical GCP URL of the resource                 |
| `cloud.google.com/service-account` | Service account email                             |
| `cloud.google.com/status`          | State the API reports, e.g. `RUNNING`, `READY`    |
| `cloud.google.com/vpc-peerings`    | Names of the peerings configured on a VPC network |
| `cloud.google.com/machine-type`    | Machine type of a Compute Engine instance         |

GKE cluster entities additionally carry the `kubernetes.io/*` annotations the Kubernetes plugin
reads — API server URL, CA certificate, `googleServiceAccount` auth provider and the GKE
dashboard parameters. That is what makes the `catalog` cluster locator work; see
[GKE and the Kubernetes plugin](../guides/gcp-permissions.md#gke-and-the-kubernetes-plugin).

## The access graph

Every role a service account holds on a resource becomes a `dependsOn` relation **on the service
account entity**. Backstage derives the reverse relation itself, so the database, secret and topic
gain their `dependencyOf` edges without their own providers doing anything — which is why IAM is
declared in exactly one place.

Policies come from **Cloud Asset Inventory**: one `searchAllIamPolicies` call per project covers
every resource in it, cached and shared across providers. Enable `cloudasset.googleapis.com` and
grant `roles/cloudasset.viewer`. Without them everything still ingests; the graph is just flat.

### Attaching a Component

The `workload-identity` provider ingests each `roles/iam.workloadIdentityUser` binding as a
`kubernetes-service-account` entity, named `<poolProject>-<k8sNamespace>-<ksaName>`. A Component
attaches with one line:

```yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: auth
spec:
  type: service
  owner: group:default/platform
  dependsOn:
    - resource:gcp-prod/prod-auth-auth-sa
```

No cluster credentials are needed: the binding lives in the Google service account's own IAM policy,
where the member is written `serviceAccount:PROJECT.svc.id.goog[namespace/ksa]`. Because an identity
pool belongs to a project rather than to a cluster, the entity relates to every
Workload-Identity-enabled cluster in that project.

### Limits worth knowing

- **Project-level grants produce no edges.** `roles/editor` on a project reaches everything and
  names nothing, so it is recorded as a `cloud.google.com/iam-project-roles` annotation instead. An
  estate managed through project-level grants will have a sparse graph.
- **Edges need the account ingested.** Keep `service-account` enabled. For the audit view over
  principals that are not ingested, set `iam.annotateResources: true`.
- **Bindings are not entities.** One per (resource, role) would multiply the catalog several times
  over on the fastest-changing data in GCP and add a hop to every path. Roles live on the account,
  in `cloud.google.com/iam-roles` and `cloud.google.com/iam-access`.

```yaml
catalog:
  providers:
    gcp:
      iam:
        enabled: true # default
        memberTypes: [serviceAccount] # default
        excludeRoles: [roles/viewer]
        maxEdgesPerMember: 200 # default
        annotateResources: false # default
        cacheTtlSeconds: 600 # default
```

## Relations

Providers relate their entities to what GCP says they depend on. Each ref is built from the
namespace of the provider that ingests the target, so a relation still resolves when the two
providers are namespaced differently — but the target provider has to be enabled for the entity
to exist at all.

| From                            | Depends on                                                         |
| ------------------------------- | ------------------------------------------------------------------ |
| Subnet, firewall rule, router   | its VPC network                                                    |
| VPC network                     | the networks it is peered with                                     |
| Cloud NAT                       | its Cloud Router                                                   |
| Compute instance                | its subnet and its service accounts                                |
| Redis instance, AlloyDB cluster | the VPC it is attached to                                          |
| Kafka cluster                   | the subnets its brokers are reachable through                      |
| Spanner / AlloyDB / Kafka child | its instance, cluster or topic parent                              |
| Pub/Sub subscription            | its topic                                                          |
| Pub/Sub topic                   | the service accounts holding a publisher role                      |
| Eventarc trigger                | its Pub/Sub topic; it is a dependency of its Cloud Run destination |
| Scheduler job, Cloud Function   | the Pub/Sub topic it publishes to or is triggered by               |
| Cloud Run, Functions, Workflows | the service account it runs as, and its VPC connector              |
| Kubernetes service account      | the Google account it impersonates, and its GKE clusters           |
| Google service account          | every resource it holds a resource-level role on                   |
| GKE cluster                     | its VPC and subnet                                                 |
| Cloud SQL instance              | the VPC it is peered with, when it has a private address           |
| Load balancer                   | its URL map → backend services → instance groups                   |
| Delivery pipeline               | its deploy targets → the GKE cluster they deploy to                |
| KMS key                         | its key ring                                                       |
| Log sink                        | the bucket, dataset or topic it exports to                         |
| SLO                             | its Monitoring service → the Cloud Run service behind it           |
| BigQuery transfer               | the dataset it loads into                                          |

Refs to Pub/Sub topics apply the same `stripPrefixes` the `pubsub` provider does, so a topic
ingested as `orders` is still found by a trigger that names it `myorg-orders`.

## Troubleshooting

**Nothing is ingested.** Check the backend log at startup: the module logs
`No GCP catalog provider configuration found` when `catalog.providers.gcp` is missing, and
`GCP <key> provider is disabled` for each `enabled: false` block. Beyond that, a provider whose
API call fails logs `error fetching GCP resources` and keeps the previous entities rather than
deleting them.

**Everything is owned by `unknown`.** The owner label is missing, or written with a key GCP
would reject. Confirm what is actually on the resource with
`gcloud storage buckets describe gs://my-bucket --format='value(labels)'` and remember that the
key on the resource is the underscore form.

**Names look mangled.** Entity names are lowercased, stripped of anything outside `[a-z0-9-]`
and truncated to 63 characters, because the catalog rejects anything else. Two GCP resources
whose names differ only in a stripped character collide; `stripPrefixes` on Pub/Sub makes that
more likely, so keep the prefix list to genuine environment prefixes.

**Permission denied in the logs.** The service account is missing a role for that specific API —
see the [permission table](../guides/gcp-permissions.md#permissions-per-provider). Each provider
fails independently, so one missing role does not stop the others.

**`Skipping project … the API is disabled` in the logs.** The provider's API is not enabled in
that project, the project no longer exists, or the credentials cannot read it. The other projects
are still ingested. Enable the API with
`gcloud services enable compute.googleapis.com --project=my-project`, substituting the API for the
provider in question.

**The catalog churns on every refresh.** Ingesting Compute Engine instances means a full mutation
per refresh over a set that changes constantly. Narrow it with `states: [RUNNING]`, bound it with
`locations`, and lengthen the `schedule`.
