# @sbordeyne/backstage-plugin-kubespec-backend

Ingests Kubernetes API specs and CRD manifests from GitHub, expands them into
browsable schemas and stores them, so the `/kubespec` page renders from the
database rather than from upstream.

Modelled on [kubespec.dev](https://kubespec.dev), scoped to the projects you
declare in `app-config.yaml`.

Full documentation — every config key, tag rules, adding a CRD source — lives at
[sbordeyne.github.io/backstage-plugins/plugins/kubespec](https://sbordeyne.github.io/backstage-plugins/plugins/kubespec/).

## Installation

```bash
yarn --cwd packages/backend add @sbordeyne/backstage-plugin-kubespec-backend
```

```ts
// packages/backend/src/index.ts
backend.add(import('@sbordeyne/backstage-plugin-kubespec-backend'));
// Optional: indexes ingested kinds into the portal's global search.
backend.add(import('@sbordeyne/backstage-plugin-kubespec-backend/alpha'));
```

Ingest reads tags and listings through `integrations.github`; there is no token
key of its own, and a read-only token is enough for public repositories:

```yaml
integrations:
  github:
    - host: github.com
      token: ${GITHUB_TOKEN}
```

Then turn sync on and name what to ingest:

```yaml
kubespec:
  sync:
    enabled: true
  kubernetes:
    minors: ['v1.33', 'v1.34']
  projects:
    - slug: cert-manager
      name: cert-manager
      repo: cert-manager/cert-manager
      releaseAsset: cert-manager.crds.yaml
      tags: { regex: '^v\d+\.\d+\.\d+$', max: 5 }
```

Migrations run at startup against the database the backend hands the plugin, so
there is nothing to run by hand. The first tick starts two minutes after boot and
then runs daily; a cold ingest is bounded per tick and resumes on the next one, so
the page fills progressively.

The frontend, [`@sbordeyne/backstage-plugin-kubespec`](../kubespec/README.md), is
what renders any of this.

## How it works

A scheduled worker runs `plan → resolve → fetch → normalize → index → diff →
commit → prune` for each configured source.

The listing GitHub returns already carries every blob's sha, so a version's
fingerprint is known before anything is downloaded: an unchanged version is
skipped without transferring a byte. File bodies come from
`raw.githubusercontent.com`, which costs no REST quota — a measured full ingest of
three sources and five versions took **9 API requests**, and the following tick
took 16 and downloaded nothing.

Each kind's schema is expanded once and stored gzipped. Those bytes are the wire
bytes: `/v1/resource/schema` streams the stored buffer under
`Content-Encoding: gzip`, so serving a schema costs a row read and no CPU. See
[ADR 04](../../docs/adr/04-adr-kubespec-storage.md) for why a blob beat a
ref-preserving graph.

## Ticks, timeouts and stuck syncs

A tick stops ingesting after `sync.maxTickDurationMinutes` (10 by default) and
leaves the rest for the next one. Nothing is truncated by that: every version is
committed on its own, and an unchanged one is recognised from its listing and
skipped without being downloaded, so the next tick resumes where this one stopped.

That exists because of how Backstage's scheduler holds a task. A worker claims a
run ticket, nothing extends it while the run is in progress, and only the
scheduler's janitor clears it once `current_run_expires_at` has passed. So
`sync.schedule.timeout` is two things at once: the longest a run may take, **and**
how long an abandoned ticket blocks every manual trigger. A pod that dies mid-sync
— a crash, a rolling deploy, a dev server reloading — leaves a ticket behind, and
`POST /v1/sync` answers `409 Conflict` until it expires.

Sizing the timeout for a whole cold ingest would make that window hours. Instead
the tick stops itself well inside a 20-minute timeout, so the worst case is 20
minutes rather than the length of the longest possible ingest. `config.test.ts`
asserts the two stay in that order.

If a ticket ever does get stranded and the wait is unacceptable, clear it — but
check first that no worker is actually running, or a second sync will start
alongside the first:

```sql
update backstage_backend_tasks__tasks
   set current_run_ticket = null, current_run_started_at = null, current_run_expires_at = null
 where id = 'kubespec-sync';
```

## Configuration

Everything lives under `kubespec` in `app-config.yaml`; `config.d.ts` is the
schema and `src/config.ts` holds the defaults.

Kubernetes is pinned to explicit minors, because upstream's tag scheme needs a
bespoke minor extraction that no declarative rule expresses. Every other project
selects tags with rules applied in a fixed order:

```
exclude (raw tag) → prefix (required, stripped) → regex (on the remainder)
→ parse → excludePrerelease → minVersion/maxVersion → sort → max
```

`prefix` has to come off before anything else looks at the tag: for
vertical-pod-autoscaler the version only exists once
`vertical-pod-autoscaler-chart-` is removed. `src/github/selectTags.test.ts` pins
this against the real tag shapes of the projects that exercise each rule.

GitHub credentials come from `integrations.github`. There is no separate token
key, and the plugin refuses to start with sync enabled and no integration
configured rather than 401ing once a day in the background.

## Endpoints

All under `/api/kubespec`, all requiring a signed-in user. The GVK travels in
query parameters rather than path segments, because groups contain dots and
`apps/v1` contains a slash.

| Method | Path                  | Returns                                                     |
| ------ | --------------------- | ----------------------------------------------------------- |
| GET    | `/v1/sources`         | configured sources with their version counts and sync state |
| GET    | `/v1/versions`        | `?source` — versions newest first, keyset-paged             |
| GET    | `/v1/resources`       | `?source&version?` — every kind in a version, no schemas    |
| GET    | `/v1/resource`        | one kind's envelope                                         |
| GET    | `/v1/resource/schema` | the expanded schema, gzip at rest, revalidated by ETag      |
| GET    | `/v1/changes/summary` | one row per older version; backs the whole history panel    |
| GET    | `/v1/changes`         | the change list for one version                             |
| GET    | `/v1/search`          | kinds, and property paths when a source is named            |
| GET    | `/v1/metadata`        | hand-authored examples and links                            |
| GET    | `/v1/status`          | per-source sync state                                       |
| POST   | `/v1/sync`            | triggers a sync tick                                        |

## Examples and links

Authored in [`metadata/`](metadata/README.md) and loaded into the database at
startup, so an edit takes effect on deploy without waiting for a sync.

## Search

`src/search` registers a collator with the portal's global search, indexing kinds
at each source's newest version only — a few thousand documents. Property paths
stay out of Elasticsearch: they would be roughly 200k documents per Kubernetes
version, to answer a question the page's own filter box answers instantly from a
schema that is already in the browser.

It is registered separately from the plugin itself:

```ts
backend.add(import('@sbordeyne/backstage-plugin-kubespec-backend')); // the API
backend.add(import('@sbordeyne/backstage-plugin-kubespec-backend/alpha')); // the collator
```

## Development

```bash
yarn workspace @sbordeyne/backstage-plugin-kubespec-backend start
yarn workspace @sbordeyne/backstage-plugin-kubespec-backend test

# Both dialects. Default runs are SQLite-only, because CI has no docker.
BACKSTAGE_TEST_ENABLE_DOCKER=1 yarn workspace @sbordeyne/backstage-plugin-kubespec-backend test

# A real ingest against GitHub. Skipped without a token.
KUBESPEC_E2E_TOKEN="$(gh auth token)" yarn workspace @sbordeyne/backstage-plugin-kubespec-backend test realIngest
```
