# @sbordeyne/plugin-catalog-backend-module-gcp-provider

Catalog backend module that ingests GCP resources as `Resource` entities: BigQuery datasets, Cloud
Storage buckets, Cloud SQL instances, Pub/Sub topics and subscriptions, Secret Manager secrets,
service accounts and GKE clusters.

## Installation

```ts
// packages/backend/src/index.ts
backend.add(import('@sbordeyne/plugin-catalog-backend-module-gcp-provider'));
```

Authentication uses Application Default Credentials. Set `GOOGLE_APPLICATION_CREDENTIALS` to a
service account key file, or rely on the ambient credentials of the environment.

## Configuration

Each provider is enabled by the presence of its config key under `catalog.providers.gcp`. Every
provider takes a `projects` list and a `schedule` block, and accepts the optional `owner` and
`region` described below.

```yaml
catalog:
  providers:
    gcp:
      # Applied to every provider below unless it sets its own
      # `owner` / `ownerLabel` / `region`.
      defaultOwner: group:default/platform
      defaultRegion: europe-west1
      # Label read off each resource to find its owner.
      # Defaults to 'backstage.io/owner-ref'.
      ownerLabel: backstage.io/owner-ref

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
        schedule: { frequency: { hours: 1 }, timeout: { minutes: 10 } }
      storage:
        projects: [my-project]
        schedule: { frequency: { hours: 1 }, timeout: { minutes: 10 } }
      secretmanager:
        projects: [my-project]
        schedule: { frequency: { hours: 1 }, timeout: { minutes: 10 } }
      clusters:
        projects: [my-project]
        schedule: { frequency: { hours: 1 }, timeout: { minutes: 10 } }
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

### Region

Not every API reports a location for every resource. The region is resolved as the value the API
returned → this provider's `region` → `defaultRegion`. If none of those yields a value, the
`cloud.google.com/region` annotation is left off rather than filled with a guess.

## Annotations

Ingested entities carry the following annotations:

| Annotation                         | Meaning                            |
| ---------------------------------- | ---------------------------------- |
| `cloud.google.com/project-id`      | GCP project owning the resource    |
| `cloud.google.com/region`          | Region or location of the resource |
| `cloud.google.com/service-account` | Service account email              |
