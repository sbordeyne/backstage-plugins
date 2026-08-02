# GCP catalog provider

`@sbordeyne/plugin-catalog-backend-module-gcp-provider`

A catalog backend module that ingests Google Cloud resources as `Resource` entities. Seven
providers ship in the module, each enabled independently by its own config block, each on its
own schedule.

| Config key        | Ingests                | `spec.type`              | Namespace              |
| ----------------- | ---------------------- | ------------------------ | ---------------------- |
| `bigquery`        | BigQuery datasets      | `bigquery-dataset`       | `bigquery-datasets`    |
| `storage`         | Cloud Storage buckets  | `bucket`                 | `buckets`              |
| `cloudsql`        | Cloud SQL instances    | `cloudsql-instance`      | `cloudsql-instances`   |
| `pubsub`          | Pub/Sub topics         | `pubsub-topic`           | `pubsub-topics`        |
| `pubsub`          | Pub/Sub subscriptions  | `pubsub-subscription`    | `pubsub-subscriptions` |
| `secretmanager`   | Secret Manager secrets | `secret`                 | `secrets`              |
| `service-account` | IAM service accounts   | `google-service-account` | `service-accounts`     |
| `clusters`        | GKE clusters           | `kubernetes-cluster`     | `clusters`             |

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
```

### Shared keys

Set once under `catalog.providers.gcp` and inherited by every provider.

| Key             | Type   | Default                  | Meaning                                           |
| --------------- | ------ | ------------------------ | ------------------------------------------------- |
| `defaultOwner`  | string | `unknown`                | `spec.owner` for resources whose label names none |
| `defaultRegion` | string | _annotation omitted_     | Region used when the GCP API reports none         |
| `ownerLabel`    | string | `backstage.io/owner-ref` | Label read off a resource to find its owner       |

### Per-provider keys

Accepted inside each provider block. `owner`, `ownerLabel` and `region` override the shared
value for that provider only.

| Key             | Type     | Default      | Meaning                                                               |
| --------------- | -------- | ------------ | --------------------------------------------------------------------- |
| `projects`      | string[] | **required** | GCP projects to enumerate                                             |
| `schedule`      | object   | **required** | Standard Backstage task schedule (`frequency`, `timeout`, …)          |
| `enabled`       | boolean  | `true`       | Set `false` to stop ingesting without deleting the block              |
| `owner`         | string   | inherited    | Owner for resources with no owner label                               |
| `ownerLabel`    | string   | inherited    | Label read off a resource to find its owner                           |
| `region`        | string   | inherited    | Region used when the API reports none                                 |
| `stripPrefixes` | string[] | `[]`         | **`pubsub` only.** Prefixes removed from topic and subscription names |

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

| Provider          | Label source                                    |
| ----------------- | ----------------------------------------------- |
| `bigquery`        | dataset metadata labels                         |
| `storage`         | bucket metadata labels                          |
| `cloudsql`        | `settings.userLabels`                           |
| `clusters`        | `resourceLabels`                                |
| `pubsub`          | topic and subscription metadata labels          |
| `secretmanager`   | secret labels                                   |
| `service-account` | **none** — IAM service accounts carry no labels |

A resource with no such label falls back to `owner` → `defaultOwner` → `unknown`. The `unknown`
fallback is a valid ref, so the catalog still accepts the entity, and an obviously wrong one, so
unlabelled resources are visible instead of silently misfiled. A label whose value is not a
usable entity ref is logged and treated as absent, rather than emitting an entity the catalog
would reject and failing the whole project's ingestion with it.

## Region

Not every API reports a location for every resource. The region is resolved as the value the
API returned → this provider's `region` → `defaultRegion`. If none of those yields a value the
`cloud.google.com/region` annotation is left off rather than filled with a guess.

## Annotations

| Annotation                         | Meaning                            |
| ---------------------------------- | ---------------------------------- |
| `cloud.google.com/project-id`      | GCP project owning the resource    |
| `cloud.google.com/region`          | Region or location of the resource |
| `cloud.google.com/service-account` | Service account email              |

GKE cluster entities additionally carry the `kubernetes.io/*` annotations the Kubernetes plugin
reads — API server URL, CA certificate, `googleServiceAccount` auth provider and the GKE
dashboard parameters. That is what makes the `catalog` cluster locator work; see
[GKE and the Kubernetes plugin](../guides/gcp-permissions.md#gke-and-the-kubernetes-plugin).

## Relations

Two providers infer more than ownership from IAM:

- **Pub/Sub topics** gain a `dependsOn` entry per IAM member holding a publisher role, pointing
  at the matching `service-accounts` namespace entity. Enable the `service-account` provider as
  well for those refs to resolve.
- **Pub/Sub subscriptions** depend on their topic.

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
