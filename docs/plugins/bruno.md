# Bruno

`@sbordeyne/backstage-plugin-bruno` · `@sbordeyne/backstage-plugin-bruno-backend` ·
`@sbordeyne/bruno-report-type`

Surfaces [Bruno](https://www.usebruno.com/) collection runs on the entity that owns them. CI
uploads Bruno's JSON report to a bucket, the backend syncs new artifacts into the Backstage
database on a schedule, and the frontend adds an entity tab with a pass/fail history chart and
per-request results.

The backend never talks to CI. Its only inputs are the bucket and the catalog, which means a
pipeline that fails to run leaves the last known report in place rather than blanking the tab.

## How a report finds its entity

1. An entity carries the annotation `usebruno.com/report-path`, whose value is the **report file
   name** — for example `users.json`.
2. The sync worker lists objects under `bruno.objectPrefix` in `bruno.bucket`.
3. An object is claimed by an entity when the **last path segment** of the object name equals
   that annotation value. `ui_tests/reports/bruno/2026-08-01T09:00:00Z/users.json` matches
   `users.json`.

Everything else about the object path is free — nest by date, by pipeline id, by branch, as you
like. If two entities claim the same report name each stores its own copy, and a warning is
logged.

## Installation

### Backend

```bash
yarn --cwd packages/backend add @sbordeyne/backstage-plugin-bruno-backend
```

```ts
// packages/backend/src/index.ts
backend.add(import('@sbordeyne/backstage-plugin-bruno-backend'));
```

The plugin runs its own migrations at startup against the database the backend provides, so
there is nothing to migrate by hand.

### Frontend

```bash
yarn --cwd packages/app add @sbordeyne/backstage-plugin-bruno
```

Add the tab to the entity page. `isBrunoReportsAvailable` keeps it off entities that have no
report, and it only ever returns true for `Component` and `System` kinds:

```tsx
// packages/app/src/components/catalog/EntityPage.tsx
import { EntityBrunoContent, isBrunoReportsAvailable } from '@sbordeyne/backstage-plugin-bruno';

const serviceEntityPage = (
  <EntityLayout>
    {/* … */}
    <EntityLayout.Route path="/api-tests" title="API tests" if={isBrunoReportsAvailable}>
      <EntityBrunoContent />
    </EntityLayout.Route>
  </EntityLayout>
);
```

### Annotate the entity

```yaml
# catalog-info.yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: users
  annotations:
    usebruno.com/report-path: users.json
spec:
  type: service
  owner: group:default/platform
```

## Configuration

Every key is optional; the defaults below are what runs if you configure nothing.

```yaml
bruno:
  bucket: my-ci-artifacts
  objectPrefix: ui_tests/reports/bruno/
  reportAnnotation: usebruno.com/report-path

  retention:
    runsPerEntity: 20

  sync:
    enabled: true
    concurrency: 5
    maxObjectSizeBytes: 26214400 # 25 MiB
    maxStoredBodyBytes: 262144 # 256 KiB
    maxArtifactAge: { days: 30 }
    schedule:
      initialDelay: { seconds: 30 }
      frequency: { minutes: 15 }
      timeout: { minutes: 10 }
```

| Key                       | Type    | Default                           | Meaning                                                           |
| ------------------------- | ------- | --------------------------------- | ----------------------------------------------------------------- |
| `bucket`                  | string  | `1e42-exchange`                   | GCS bucket holding the report artifacts                           |
| `objectPrefix`            | string  | `ui_tests/reports/bruno/`         | Object prefix scanned by the sync worker                          |
| `reportAnnotation`        | string  | `usebruno.com/report-path`        | Entity annotation naming the report an entity owns                |
| `retention.runsPerEntity` | number  | `20`                              | Runs kept per entity, newest first. `-1` keeps everything         |
| `sync.enabled`            | boolean | `true`                            | Whether the sync task is scheduled at all                         |
| `sync.concurrency`        | number  | `5`                               | Artifacts downloaded in parallel                                  |
| `sync.maxObjectSizeBytes` | number  | `26214400`                        | Artifacts larger than this are skipped entirely                   |
| `sync.maxStoredBodyBytes` | number  | `262144`                          | Request/response bodies are truncated to this before being stored |
| `sync.maxArtifactAge`     | object  | _no limit_                        | `{ days, hours }` — ignore artifacts created longer ago than this |
| `sync.schedule`           | object  | 30s delay, every 15m, 10m timeout | Standard Backstage task schedule                                  |

Three of these are the levers that matter at scale:

- **`sync.maxArtifactAge`** bounds the cost of listing the prefix. Without it every tick lists
  every object ever written. Set it to comfortably more than your retention window.
- **`retention.runsPerEntity`** is the only bound on table growth. `-1` disables it, which is
  supported but is a decision, not a default.
- **`sync.maxStoredBodyBytes`** caps what a single result detail response can return. Bruno
  reports embed full request and response bodies, which for a large API can be megabytes each.

The task runs with the scheduler's `global` scope, so exactly one backend replica performs a
given tick.

## Storage layout and CI

Bruno writes a JSON report with `bru run --output`. Upload it under the configured prefix with
the file name that matches the annotation:

```bash
bru run --env ci --output users.json --format json
gcloud storage cp users.json \
  "gs://my-ci-artifacts/ui_tests/reports/bruno/$(date -u +%Y-%m-%dT%H:%M:%SZ)/users.json"
```

The backend diffs on the GCS object **generation**, so re-uploading to the same object path
creates a new run, and an object rewritten between listing and download is downloaded at the
generation that was listed rather than silently mixing versions.

### Bucket permissions

The backend needs to list and read objects under the prefix, and nothing else:

```bash
gcloud storage buckets add-iam-policy-binding gs://my-ci-artifacts \
  --member="serviceAccount:backstage@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role=roles/storage.objectViewer
```

Credentials are Application Default Credentials, exactly as for the
[GCP catalog provider](gcp-catalog-provider.md#authentication) — see
[GCP permissions](../guides/gcp-permissions.md) for Workload Identity and Terraform.

## API

Mounted at `/api/bruno`. Every path re-derives visibility from the owning entity through the
catalog on each request, so a user who cannot see the entity cannot read its runs — reading the
plugin's own tables directly would bypass the catalog's permission model.

| Method | Path                      | Purpose                                                          |
| ------ | ------------------------- | ---------------------------------------------------------------- |
| `GET`  | `/v1/runs?entityRef=`     | Runs for an entity, newest first. `limit` ≤ 100, `cursor`        |
| `GET`  | `/v1/runs/:runId`         | One run's summary                                                |
| `GET`  | `/v1/runs/:runId/results` | Results in a run. `limit` ≤ 200, `cursor`, `status`, `iteration` |
| `GET`  | `/v1/results/:resultId`   | One result's detail, including truncated bodies                  |
| `POST` | `/v1/sync`                | Trigger a sync tick immediately. Returns `202`                   |

`entityRef` is a query parameter rather than a path segment because entity refs contain `:` and
`/`, and an encoded slash inside a path segment gets normalized away by some ingresses.

Result details never change once stored, so they are served with a one-year immutable
`Cache-Control`.

## Troubleshooting

**The tab says the annotation is missing.** `EntityBrunoContent` renders the missing-annotation
empty state unless the entity is a `Component` or `System` carrying `usebruno.com/report-path`.

**The tab is empty but the annotation is there.** Look for the sync summary line in the backend
log: it reports how many objects were listed, claimed, unmatched, too old and too large. An
artifact counted as `unmatched` means no entity claims that file name — the last path segment
and the annotation value have to be equal, extension included.

**`No catalog entity carries the … annotation`.** The worker stops early rather than treating a
catalog blip as "every report is orphaned". Nothing is deleted when this happens.

**`POST /v1/sync` returns 404.** Sync is disabled — set `bruno.sync.enabled` to `true`. Without
this check the failure surfaces as a bare "task does not exist".
