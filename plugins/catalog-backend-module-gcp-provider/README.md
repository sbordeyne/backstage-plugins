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
      # Applied to every provider below unless it sets its own `owner` / `region`.
      defaultOwner: group:default/platform
      defaultRegion: europe-west1

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

GCP exposes nothing that maps onto a Backstage group, so `spec.owner` cannot be inferred from the
resource. It is resolved per provider as `owner` → `defaultOwner` → `unknown`. The `unknown`
fallback is a valid ref, so the catalog still accepts the entities, and an obviously wrong one, so
an unconfigured installation is visible instead of silently misfiled.

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
