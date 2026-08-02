# Bruno

`@sbordeyne/backstage-plugin-bruno` · `@sbordeyne/backstage-plugin-bruno-backend` ·
`@sbordeyne/bruno-report-type`

Surfaces [Bruno](https://www.usebruno.com/) collection runs on the entity that owns them. CI
uploads Bruno's JSON report to a bucket, the backend syncs new artifacts into the Backstage
database on a schedule, and the frontend adds an entity tab with a pass/fail history chart and
per-request results.

The backend never talks to CI. Its only inputs are the bucket and the catalog, which means a
pipeline that fails to run leaves the last known report in place rather than blanking the tab.

## Where reports come from

Three sources ship with the plugin, one enabled at a time under `bruno.source`:

| `type`   | Reads                                  | Credentials                              |
| -------- | -------------------------------------- | ---------------------------------------- |
| `gcs`    | Objects under a prefix in a GCS bucket | Application Default Credentials          |
| `s3`     | Objects under a prefix in an S3 bucket | The `aws` config block, or the AWS chain |
| `github` | GitHub Actions workflow artifacts      | The matching `integrations.github` entry |

None of them takes a credential of its own: each reuses the mechanism the rest of Backstage
already uses for that cloud.

## How a report finds its entity

1. An entity carries the annotation `usebruno.com/report-path`, whose value is the **report file
   name** — for example `users.json`.
2. The sync worker asks the configured source for what it holds.
3. An artifact is claimed by an entity when the **last `/` segment** of its name equals that
   annotation value. `ui_tests/reports/bruno/2026-08-01T09:00:00Z/unit/users.json` matches
   `users.json`, and so does a GitHub artifact simply named `users.json`.

Which artifacts a source offers at all is the source's own business — a prefix and a suite
directory for the object stores, a name prefix and a branch for GitHub. If two entities claim the
same report name each stores its own copy, and a warning is logged.

!!! warning "Object stores filter on a `unit/` directory by default"

    `requiredPathSegment` defaults to `unit`, so a GCS or S3 object is only considered when it
    sits **directly under a `unit/` segment**: `.../run-42/unit/users.json` is read,
    `.../run-42/integration/users.json` is not, and neither is `.../unit/nested/users.json`.
    That default preserves the behaviour the plugin has always had. Set it to `false` if your
    layout has no suite directory.

### GitHub artifacts are matched by artifact name

An artifact listing says nothing about what is inside the zip, and downloading every archive to
find out would defeat the point of listing first. So the **artifact name** is what the annotation
is matched against: an artifact named `users.json` is the report `users.json`.

On download the archive is unwrapped: a single `.json` entry is taken as the report, and an
archive holding several is resolved by the entry whose file name matches the artifact. An archive
with several JSON files and no such entry is an error, not a guess.

```yaml
# .github/workflows/ui-tests.yaml
- run: bru run --env ci --output users.json --format json
- uses: actions/upload-artifact@v4
  with:
    name: users.json # matched against usebruno.com/report-path
    path: users.json
```

Use `namePrefix` when a bare report name would collide with your other artifacts — it filters the
listing and is stripped before matching, so `bruno-users.json` with `namePrefix: bruno-` claims
`users.json`.

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
  source:
    type: gcs
    gcs:
      bucket: my-ci-artifacts
      prefix: ui_tests/reports/bruno/
      requiredPathSegment: unit
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
| `source.type`             | enum    | `gcs`                             | `gcs`, `s3` or `github` — see [Sources](#sources)                 |
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

## Sources

### GCS

```yaml
bruno:
  source:
    type: gcs
    gcs:
      bucket: my-ci-artifacts
      prefix: ui_tests/reports/bruno/
      requiredPathSegment: unit
```

| Key                   | Type            | Default                   | Meaning                                     |
| --------------------- | --------------- | ------------------------- | ------------------------------------------- |
| `bucket`              | string          | **required**              | Bucket holding the report artifacts         |
| `prefix`              | string          | `ui_tests/reports/bruno/` | Object prefix scanned by the sync worker    |
| `requiredPathSegment` | string \| false | `unit`                    | Directory an object must sit directly under |

Credentials are Application Default Credentials, exactly as for the
[GCP catalog provider](gcp-catalog-provider.md#authentication).

```bash
gcloud storage buckets add-iam-policy-binding gs://my-ci-artifacts \
  --member="serviceAccount:backstage@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role=roles/storage.objectViewer
```

GCS objects carry a **generation**, so the download pins the generation that was listed: an object
rewritten in between is not silently mixed into the old run, and the next tick reads it as the new
run it is.

### S3

```yaml
bruno:
  source:
    type: s3
    s3:
      bucket: my-ci-artifacts
      prefix: ui_tests/reports/bruno/
      requiredPathSegment: unit
      region: eu-west-1
```

| Key                   | Type            | Default                       | Meaning                                                  |
| --------------------- | --------------- | ----------------------------- | -------------------------------------------------------- |
| `bucket`              | string          | **required**                  | Bucket holding the report artifacts                      |
| `prefix`              | string          | `ui_tests/reports/bruno/`     | Object prefix scanned by the sync worker                 |
| `requiredPathSegment` | string \| false | `unit`                        | Directory an object must sit directly under              |
| `region`              | string          | STS region, then `AWS_REGION` | Region of the bucket                                     |
| `endpoint`            | string          | AWS                           | Alternative endpoint, for MinIO and other S3-compatibles |
| `forcePathStyle`      | boolean         | `false`                       | Addresses the bucket as a path, as MinIO requires        |
| `accountId`           | string          | the default account           | Which `aws.accounts` entry to take credentials from      |

Credentials come from the `aws` config block through Backstage's AWS credentials manager, falling
back to the ambient AWS chain — instance role, `AWS_*` environment variables, `~/.aws/config` —
when there is none:

```yaml
aws:
  accounts:
    - accountId: '123456789012'
      accessKeyId: ${AWS_ACCESS_KEY_ID}
      secretAccessKey: ${AWS_SECRET_ACCESS_KEY}
```

The IAM policy needs listing and reading, scoped to the prefix:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::my-ci-artifacts",
      "Condition": { "StringLike": { "s3:prefix": "ui_tests/reports/bruno/*" } }
    },
    {
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::my-ci-artifacts/ui_tests/reports/bruno/*"
    }
  ]
}
```

S3 has no generation to pin, so the **ETag** listed is asserted on download with `If-Match`. An
object overwritten in between fails that request rather than storing new bytes under the old
version; the next tick picks it up.

### GitHub Actions artifacts

```yaml
bruno:
  source:
    type: github
    github:
      repository: my-org/my-repo
      namePrefix: bruno-
      branch: main
```

| Key          | Type   | Default      | Meaning                                                     |
| ------------ | ------ | ------------ | ----------------------------------------------------------- |
| `repository` | string | **required** | Repository holding the workflow runs, as `owner/repo`       |
| `host`       | string | `github.com` | GitHub host, matched against `integrations.github`          |
| `namePrefix` | string | `''`         | Only artifacts starting with this; stripped before matching |
| `branch`     | string | every branch | Only artifacts from a workflow run on this branch           |

Credentials come from the matching `integrations.github` entry — a token or a GitHub App, as set
up in [Third-party integrations](../guides/integrations.md#github). The credential needs
**Actions: read** on the repository, in addition to the metadata read any integration has.

Expired artifacts are skipped: GitHub keeps them in the listing after deleting their bytes, so
downloading one is a guaranteed 410. An artifact id is unique per upload and never reused, so it
is what the sync diffs on — re-running a workflow produces a new run.

`sync.maxObjectSizeBytes` is checked twice for this source: against the artifact's compressed size
when listing, and against the entry's uncompressed size before unpacking, so a small archive
cannot expand without bound.

## CI upload

Bruno writes a JSON report with `bru run --output`. Upload it with the file name that matches the
annotation:

```bash
bru run --env ci --output users.json --format json

# GCS
gcloud storage cp users.json \
  "gs://my-ci-artifacts/ui_tests/reports/bruno/$(date -u +%Y-%m-%dT%H:%M:%SZ)/unit/users.json"

# S3
aws s3 cp users.json \
  "s3://my-ci-artifacts/ui_tests/reports/bruno/$(date -u +%Y-%m-%dT%H:%M:%SZ)/unit/users.json"
```

Mind the `unit/` segment: with the default `requiredPathSegment` an object that is not directly
under one is listed and then ignored.

Credentials for the GCP path are Application Default Credentials, exactly as for the
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
log: it names the source it is reading and reports how many artifacts were listed, claimed,
unmatched, too old and too large. An artifact counted as `unmatched` means no entity claims that
name — the last path segment and the annotation value have to be equal, extension included.

**Nothing is even listed from an object store.** Almost always `requiredPathSegment`: with its
default of `unit`, an object not sitting directly under a `unit/` segment is skipped before it is
counted. Set it to `false` if your layout has no suite directory.

**A GitHub artifact is listed but fails on download.** Either the archive holds several JSON
files and none is named after the artifact — name the artifact after the report, or upload one
report per artifact — or the entry unpacks past `sync.maxObjectSizeBytes`.

**Migrating from an older install.** `bruno.bucket` and `bruno.objectPrefix` still work on their
own and mean GCS. Setting them alongside `bruno.source` is refused at startup rather than
silently resolved, since only one of them can be the intended one.

**`No catalog entity carries the … annotation`.** The worker stops early rather than treating a
catalog blip as "every report is orphaned". Nothing is deleted when this happens.

**`POST /v1/sync` returns 404.** Sync is disabled — set `bruno.sync.enabled` to `true`. Without
this check the failure surfaces as a bare "task does not exist".
