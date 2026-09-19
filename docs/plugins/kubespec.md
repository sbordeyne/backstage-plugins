# Kubespec

`@sbordeyne/backstage-plugin-kubespec` · `@sbordeyne/backstage-plugin-kubespec-backend` ·
`@sbordeyne/kubespec-common`

A browsable reference for the Kubernetes API and for the CRDs of the operators you run, modelled
on [kubespec.dev](https://kubespec.dev) and scoped to the projects you list in `app-config.yaml`.
The backend ingests specs and CRD manifests from GitHub on a schedule, expands each kind into a
property tree and stores it; the `/kubespec` page renders from that database, never from upstream.

Every source is a GitHub repository plus a rule for which tags to ingest. Nothing talks to a
cluster: a CRD is read from the manifest that ships it, so a kind is browsable before anyone has
installed the operator.

## What a reader gets

- The full property tree of a kind, with types, defaults, required flags and descriptions,
  filterable and deep-linkable down to a single property (`#.spec.template.spec.containers`).
- A version picker per source, and a change list diffing a version against the one before it.
- Global search over kinds, and property-path search within a source.
- Hand-authored examples and documentation links, shipped in the backend package.

## Installation

The frontend is a view onto the backend's database and has no other data source, so **the backend
is required**. Install it first.

### Backend

```bash
yarn --cwd packages/backend add @sbordeyne/backstage-plugin-kubespec-backend
```

```ts
// packages/backend/src/index.ts
backend.add(import('@sbordeyne/backstage-plugin-kubespec-backend'));
// Optional: indexes ingested kinds into the portal's global search.
backend.add(import('@sbordeyne/backstage-plugin-kubespec-backend/alpha'));
```

The collator is a separate registration on purpose — the API is useful without search, and search
is what costs index space.

Migrations run at startup against the database the backend hands the plugin, so there is no
migration step to run by hand. Examples and links are loaded from the package at the same moment,
which is why editing them takes effect on deploy rather than on the next sync.

### GitHub credentials

Ingest reads tags, directory listings and release assets through `integrations.github`, and file
bodies from `raw.githubusercontent.com`. There is no token key of its own:

```yaml
integrations:
  github:
    - host: github.com
      token: ${GITHUB_TOKEN}
```

A read-only token, or a GitHub App with metadata and contents read, is enough for public
repositories. With `kubespec.sync.enabled` true and no integration configured the plugin refuses
to start, rather than 401ing once a day in the background.

### Frontend

```bash
yarn --cwd packages/app add @sbordeyne/backstage-plugin-kubespec
```

On the [new frontend system](https://backstage.io/docs/frontend-system/):

```tsx
// packages/app/src/App.tsx
import kubespecPlugin from '@sbordeyne/backstage-plugin-kubespec/alpha';

const app = createApp({
  features: [kubespecPlugin],
});
```

The page carries its own title and icon, which is what puts `Kubespec` in the sidebar — there is
no `SidebarItem` to add. Path, title and icon are overridable from config:

```yaml
app:
  extensions:
    - page:kubespec:
        config:
          path: /api-reference
          title: K8s API
```

On the legacy frontend system, the package root still exports a plugin and a routable extension:

```tsx
// packages/app/src/App.tsx
import { KubespecPageExtension, kubespecPlugin } from '@sbordeyne/backstage-plugin-kubespec';

<FlatRoutes>
  <Route path="/kubespec" element={<KubespecPageExtension />} />
</FlatRoutes>;
```

`kubespecPlugin` registers the API client, so the plugin has to be picked up by the app (any
import from `apis.ts` or a `plugins.ts` barrel does it) even when only the route is mounted.

Two frontend-visible keys:

| Key                      | Type   | Default      | Meaning                                                        |
| ------------------------ | ------ | ------------ | -------------------------------------------------------------- |
| `kubespec.defaultSource` | string | `kubernetes` | Source the page opens on, and the one `/kubespec` redirects to |
| `kubespec.contributeUrl` | string | _unset_      | Where readers are sent to contribute an example or a link      |

Unset, `contributeUrl` drops the call to action from the empty states rather than linking nowhere.

### First run

```yaml
kubespec:
  sync:
    enabled: true
  kubernetes:
    minors: ['v1.33', 'v1.34']
```

The first tick starts two minutes after boot and then runs daily. It is also triggerable from the
page's sync button, which is `POST /api/kubespec/v1/sync`. A cold ingest is bounded per tick and
resumes on the next one, so the page fills progressively rather than in one shot.

URLs are five fixed segments, with `latest` and `core` as literal stand-ins:

```
/kubespec/kubernetes/latest/apps/v1/Deployment
/kubespec/kubernetes/v1.33/core/v1/Pod
/kubespec/cert-manager/v1.19.1/cert-manager.io/v1/Certificate
```

## Adding a CRD source

A source is one entry under `kubespec.projects`. It names a repository, where the CRDs live in it,
and which tags to ingest:

```yaml
kubespec:
  projects:
    - slug: keda
      name: KEDA
      repo: kedacore/keda
      paths: ['config/crd/bases']
      tags: { minVersion: 'v2.16.0', max: 5 }
```

| Key            | Type             | Default      | Meaning                                                     |
| -------------- | ---------------- | ------------ | ----------------------------------------------------------- |
| `slug`         | string           | **required** | URL segment and primary key, e.g. `keda`                    |
| `name`         | string           | **required** | Display name in the source picker                           |
| `repo`         | string           | **required** | `owner/repo` on GitHub                                      |
| `paths`        | string[]         | —            | Candidate manifest paths, each a file or a directory        |
| `pathsMode`    | `first` \| `all` | `first`      | Whether the first resolving path wins, or all of them count |
| `releaseAsset` | string           | —            | Asset name to download per release, instead of `paths`      |
| `logoUrl`      | string           | —            | Icon in the source picker                                   |
| `order`        | number           | —            | Display order in the source picker                          |
| `tags`         | object           | `{}`         | Which tags become versions — see [Tag rules](#tag-rules)    |

`paths` and `releaseAsset` are alternatives. A project needs one of them; with neither, every tag
resolves to nothing and the version fails with `No manifests at any of []`.

### Where the manifests are

`paths` entries are tried **in order**, and each one is walked recursively when it is a directory.
Under the default `pathsMode: 'first'`, the first path that resolves at a given tag wins and the
rest are not fetched — which is what lets one entry cover a repository that moved its CRD
directory between releases, since the older layout simply 404s at newer tags:

```yaml
# Newest layout first.
paths: ['config/crd/bases', 'deploy/crds', 'charts/operator/crds']
```

Use `pathsMode: 'all'` when the CRDs genuinely live in several places at the same tag; duplicate
paths across candidates are collapsed, first candidate winning.

Some projects publish a single rendered manifest with each release instead. That is `releaseAsset`,
which skips the directory walk entirely:

```yaml
- slug: cert-manager
  name: cert-manager
  repo: cert-manager/cert-manager
  releaseAsset: cert-manager.crds.yaml
  tags: { regex: '^v\d+\.\d+\.\d+$', max: 5 }
```

A full install manifest works as well as a CRDs-only one — everything that is not a CRD is
ignored — but the CRDs-only asset is smaller and downloads faster when a project offers both.

### What is read from them

Every file found is parsed as multi-document YAML, and only documents with
`apiVersion: apiextensions.k8s.io/v1` and `kind: CustomResourceDefinition` are kept. Each served
version of each CRD becomes one browsable kind, expanded from its `openAPIV3Schema`.

- **`v1beta1` CRDs are ignored.** They put the schema elsewhere and have been gone from Kubernetes
  since 1.22; a project that still ships only those ingests as empty.
- `NOTES.txt`, `OWNERS`, `kustomization.yaml`, `*.md` and `*.go` are skipped — they sit beside CRDs
  and never contain one.
- A CRD recovered from malformed YAML is kept, with a warning. A file that cannot be parsed at all
  is skipped, and the rest of the version still ingests.
- Helm templates are **not** rendered. A `crds/` directory works because Helm keeps it untemplated;
  a chart's `templates/` directory does not.

### Tag rules

`tags` selects which git tags become versions. The rules are applied in a fixed order, and the
order matters:

```
exclude (raw tag) → prefix (required, stripped) → regex (on the remainder)
→ parse → excludePrerelease → minVersion/maxVersion → sort → max
```

| Key                 | Type    | Default | Meaning                                                           |
| ------------------- | ------- | ------- | ----------------------------------------------------------------- |
| `exclude`           | regex   | —       | Drops a tag, matched against the **raw** tag before `prefix`      |
| `prefix`            | string  | —       | Required prefix, stripped; the remainder is the displayed version |
| `regex`             | regex   | —       | Tag must match, applied **after** `prefix` is stripped            |
| `excludePrerelease` | boolean | `true`  | Drops `-rc.1`, `-beta2`, `-bc1` and friends                       |
| `minVersion`        | string  | —       | Inclusive lower bound; a leading `v` is tolerated on either side  |
| `maxVersion`        | string  | —       | Inclusive upper bound                                             |
| `max`               | number  | `10`    | Keep at most this many versions, newest first                     |

An unparseable tag is dropped rather than failing the project, and a release published under two
spellings — Cilium ships both `1.20.1` and `v1.20.1` — is ingested once.

Three shapes cover almost everything:

=== "A floor"

    ```yaml
    tags: { minVersion: 'v1.6.1', max: 5 }
    ```

    The common case. Pick the oldest version anybody still runs.

=== "A shape"

    ```yaml
    tags: { regex: '^v\d+\.\d+\.\d+$', max: 5 }
    ```

    For a repository that also tags subprojects: cert-manager's `cmd/ctl/v1.21.1` fails this and
    its releases pass.

=== "A prefix"

    ```yaml
    tags:
      prefix: 'gha-runner-scale-set-'
      regex: '^\d+\.\d+\.\d+$'
      max: 5
    ```

    For a monorepo whose tags are per-component. The prefix comes off first, so what is parsed,
    compared and displayed is `0.13.0`.

!!! warning "`max` is the only cost control"

    Without `minVersion`, `max` alone bounds a project. Each version is a full expansion of every
    kind it defines, stored gzipped, and versions within a source are ingested sequentially
    because each one is diffed against its predecessor. Ten versions of a 30-kind operator is a
    real ingest; leaving `max` at its default while adding twenty projects is a long first tick.

### Checking a new source

With the source added and `sync.enabled` true, trigger a tick from the page's sync button and read
the backend log. A version that resolves nothing says so by name:

```
No manifests at any of [config/crd/bases] for v2.18.0
```

`GET /api/kubespec/v1/status` reports per-source sync state, including the last error. A source
that ingested but shows no kinds means the files were found and held no `apiextensions.k8s.io/v1`
CRD — check whether the path holds Helm templates or `v1beta1` definitions.

To find the right path for a repository, list a tag's tree rather than guessing:

```bash
gh api "repos/kedacore/keda/contents/config/crd/bases?ref=v2.18.0" --jq 'map(.name)'
gh api repos/cert-manager/cert-manager/releases/tags/v1.19.1 --jq '.assets | map(.name)'
```

### Removing a source

Drop the entry. The next sync prunes it from the database, because `pruneUnknownSources` defaults
to `true`. Set it to `false` to leave removed sources browsable but frozen. Dropping a single
`minors` entry from the Kubernetes source prunes that version the same way.

## Config example: commonly used CRDs

Every entry below is a real repository layout, with tag rules matched to how that project
actually tags. Bounds are examples — set `minVersion` to the oldest release you care about.

```yaml
kubespec:
  sync:
    enabled: true

  # The core API is pinned to explicit minors rather than tag rules.
  kubernetes:
    minors: ['v1.32', 'v1.33', 'v1.34']

  projects:
    # A release asset: one rendered manifest per release, no directory walk.
    - slug: cert-manager
      name: cert-manager
      repo: cert-manager/cert-manager
      logoUrl: https://avatars.githubusercontent.com/u/39950598?s=48&v=4
      releaseAsset: cert-manager.crds.yaml
      tags: { regex: '^v\d+\.\d+\.\d+$', max: 5 }

    - slug: gateway-api
      name: Gateway API
      repo: kubernetes-sigs/gateway-api
      paths: ['config/crd/standard']
      tags: { minVersion: 'v1.0.0', max: 5 }

    - slug: prometheus-operator
      name: Prometheus Operator
      repo: prometheus-operator/prometheus-operator
      paths: ['example/prometheus-operator-crd']
      tags: { minVersion: 'v0.80.0', max: 5 }

    - slug: argo-cd
      name: Argo CD
      repo: argoproj/argo-cd
      paths: ['manifests/crds']
      tags: { regex: '^v\d+\.\d+\.\d+$', max: 5 }

    - slug: argo-workflows
      name: Argo Workflows
      repo: argoproj/argo-workflows
      paths: ['manifests/base/crds/full']
      tags: { regex: '^v\d+\.\d+\.\d+$', max: 5 }

    - slug: external-secrets
      name: External Secrets
      repo: external-secrets/external-secrets
      paths: ['deploy/crds'] # a single bundle.yaml
      tags: { minVersion: 'v0.19.0', max: 5 }

    - slug: keda
      name: KEDA
      repo: kedacore/keda
      paths: ['config/crd/bases']
      tags: { minVersion: 'v2.16.0', max: 5 }

    - slug: kyverno
      name: Kyverno
      repo: kyverno/kyverno
      paths: ['config/crds']
      tags: { regex: '^v\d+\.\d+\.\d+$', max: 5 }

    - slug: crossplane
      name: Crossplane
      repo: crossplane/crossplane
      paths: ['cluster/crds']
      tags: { minVersion: 'v1.18.0', max: 5 }

    - slug: cilium
      name: Cilium
      repo: cilium/cilium
      # Cilium publishes each release as both `1.20.1` and `v1.20.1`; one
      # spelling is selected and the duplicate is dropped.
      paths: ['pkg/k8s/apis/cilium.io/client/crds/v2']
      tags: { regex: '^\d+\.\d+\.\d+$', minVersion: '1.17.0', max: 5 }

    - slug: istio
      name: Istio
      repo: istio/istio
      # A single generated file rather than a directory.
      paths: ['manifests/charts/base/files/crd-all.gen.yaml']
      tags: { regex: '^\d+\.\d+\.\d+$', minVersion: '1.24.0', max: 5 }

    - slug: karpenter
      name: Karpenter (AWS)
      repo: aws/karpenter-provider-aws
      # Ships both karpenter.sh and karpenter.k8s.aws kinds.
      paths: ['pkg/apis/crds']
      tags: { regex: '^v\d+\.\d+\.\d+$', max: 5 }

    - slug: sealed-secrets
      name: Sealed Secrets
      repo: bitnami-labs/sealed-secrets
      paths: ['helm/sealed-secrets/crds']
      tags: { regex: '^v\d+\.\d+\.\d+$', max: 5 }

    - slug: flux
      name: Flux
      repo: fluxcd/flux2
      # The full install manifest; everything that is not a CRD is ignored.
      releaseAsset: install.yaml
      tags: { regex: '^v\d+\.\d+\.\d+$', max: 5 }

    - slug: actions-runner-controller
      name: GitHub Actions Runner Controller
      repo: actions/actions-runner-controller
      paths: ['charts/gha-runner-scale-set-controller/crds']
      tags:
        prefix: 'gha-runner-scale-set-'
        regex: '^\d+\.\d+\.\d+$'
        max: 5

    - slug: vertical-pod-autoscaler
      name: Vertical Pod Autoscaler
      repo: kubernetes/autoscaler
      # A monorepo: the chart prefix is what separates VPA's tags from
      # cluster-autoscaler's, and the version only exists once it comes off.
      paths: ['vertical-pod-autoscaler/deploy/vpa-v1-crd-gen.yaml']
      tags:
        prefix: 'vertical-pod-autoscaler-chart-'
        regex: '^\d+\.\d+\.\d+$'
        max: 5
```

!!! note "Layouts move"

    These paths are where each project keeps its CRDs today. When a project relocates them, add
    the new path **before** the old one in `paths` rather than replacing it — with the default
    `pathsMode: 'first'`, old tags keep resolving through the old entry.

## The Kubernetes source

The core API is configured separately, because upstream's tag scheme needs a bespoke minor
extraction that no declarative rule expresses. Minors are pinned explicitly:

```yaml
kubespec:
  kubernetes:
    minors: ['v1.32', 'v1.33', 'v1.34']
```

| Key               | Type     | Default                         | Meaning                                                    |
| ----------------- | -------- | ------------------------------- | ---------------------------------------------------------- |
| `enabled`         | boolean  | `true`                          | Whether the core source is ingested at all                 |
| `minors`          | string[] | _empty_                         | Minors to ingest. Empty means the source is skipped        |
| `name`            | string   | `Kubernetes`                    | Display name                                               |
| `repo`            | string   | `kubernetes/kubernetes`         | Where the spec comes from                                  |
| `specPath`        | string   | `api/openapi-spec/swagger.json` | Path to the OpenAPI spec in that repo                      |
| `refTemplate`     | string   | `{minor}.0`                     | Git tag holding a minor's spec; `{minor}` is substituted   |
| `categories`      | object   | the kubespec.dev map            | Category heading → the kinds filed under it                |
| `defaultCategory` | string   | `Other`                         | Where a kind in no category lands                          |
| `categoryOrder`   | string[] | the built-in order              | Order of the headings; unlisted ones follow alphabetically |

`categories` **replaces** the default map rather than merging into it, so adding one kind means
copying the default and editing it — merging would make "why is this kind filed here?"
unanswerable from the config alone. A kind in no category falls into `defaultCategory`, which is
what lets a new upstream kind appear without a code change.

## Sync, search and limits

Everything below has a working default; configure none of it and the plugin runs.

```yaml
kubespec:
  pruneUnknownSources: true

  search:
    scope: latest
    maxDepth: 6
    maxResults: 50

  sync:
    enabled: true
    concurrency: 4
    fileConcurrency: 8
    maxVersionsPerTick: 60
    maxTickDurationMinutes: 10
    maxSpecBytes: 67108864
    maxResourceNodes: 50000
    maxResourceDepth: 20
    schedule:
      initialDelay: { minutes: 2 }
      frequency: { hours: 24 }
      timeout: { minutes: 20 }
```

| Key                           | Default        | Meaning                                                                |
| ----------------------------- | -------------- | ---------------------------------------------------------------------- |
| `pruneUnknownSources`         | `true`         | Delete stored sources no longer listed in config                       |
| `search.scope`                | `latest`       | `latest` indexes each source's newest version; `all` indexes every one |
| `search.maxDepth`             | `6`            | Property paths deeper than this are not indexed                        |
| `search.maxResults`           | `50`           | Results returned per search                                            |
| `sync.enabled`                | `true`         | Whether the sync task is scheduled at all                              |
| `sync.concurrency`            | `4`            | Sources ingested in parallel; versions within a source are sequential  |
| `sync.fileConcurrency`        | `8`            | Manifest files downloaded in parallel within one version               |
| `sync.maxVersionsPerTick`     | `60`           | Versions ingested per tick, across all sources                         |
| `sync.maxTickDurationMinutes` | `10`           | When a tick stops and leaves the rest for the next one                 |
| `sync.maxSpecBytes`           | `67108864`     | A single spec or manifest larger than this is rejected                 |
| `sync.maxResourceNodes`       | `50000`        | A kind expanding past this is stored truncated and flagged             |
| `sync.maxResourceDepth`       | `20`           | Expansion depth limit; the deepest real schema measured is 14          |
| `sync.schedule`               | 2m / 24h / 20m | Standard Backstage task schedule                                       |

`search.scope: all` costs roughly 1.6M rows and ~400MB in a shared portal database, and buys
property search while browsing an older version. `latest` is ~170k rows.

An unchanged version is recognised from its listing — GitHub returns every blob's sha, so a
version's fingerprint is known before a byte is downloaded — and skipped. Steady-state ticks
download nothing.

!!! warning "Keep `sync.schedule.timeout` above `maxTickDurationMinutes`"

    The scheduler never extends a running task's ticket, and only its janitor clears an expired
    one. That timeout is therefore also how long an abandoned ticket — a crashed pod, a rolling
    deploy, a reloading dev server — blocks every manual sync with `409 Conflict`. The tick stops
    itself inside the timeout instead of being killed by it, which is what keeps that window
    short without ever truncating work: each version commits on its own.

## API

Mounted at `/api/kubespec`; every path requires a signed-in user. The GVK travels in query
parameters, because groups contain dots and `apps/v1` contains a slash.

| Method | Path                  | Returns                                                  |
| ------ | --------------------- | -------------------------------------------------------- |
| `GET`  | `/v1/sources`         | Configured sources with version counts and sync state    |
| `GET`  | `/v1/versions`        | `?source` — versions newest first, keyset-paged          |
| `GET`  | `/v1/resources`       | `?source&version?` — every kind in a version, no schemas |
| `GET`  | `/v1/resource`        | One kind's envelope                                      |
| `GET`  | `/v1/resource/schema` | The expanded schema, gzip at rest, revalidated by ETag   |
| `GET`  | `/v1/changes/summary` | One row per older version; backs the history panel       |
| `GET`  | `/v1/changes`         | The change list for one version                          |
| `GET`  | `/v1/search`          | Kinds, and property paths when a source is named         |
| `GET`  | `/v1/metadata`        | Hand-authored examples and links                         |
| `GET`  | `/v1/status`          | Per-source sync state                                    |
| `POST` | `/v1/sync`            | Triggers a tick. `?force=true` re-reads every source     |

`force=true` ignores stored content hashes, which is the way to recover from a force-pushed tag
whose content changed under a version already ingested.

## Examples and links

Examples and documentation links are authored as files in the backend package, under
`metadata/<source>/<apiVersion>/<kind lowercased>/`:

- `N-<slug>.md` — one example, with `title` and `description` frontmatter and the manifest in a
  fenced YAML block. `N` orders the accordion on the page.
- `<kind>.json` — `{ "links": [{ "name", "href" }] }`, external documentation.

They are loaded into the database at backend startup, so an edit takes effect on deploy without
waiting for a sync. `kubespec.metadataDir` points the loader at an absolute path instead, which is
only useful while authoring locally — production resolves the directory from the package.

## Troubleshooting

**The page says nothing has been ingested.** Either `sync.enabled` is false, or the first tick has
not run yet — it starts two minutes after boot. Press the sync button and watch `/v1/status`.

**`POST /v1/sync` returns 404.** Sync is disabled. Without this check the failure surfaces as a
bare "task does not exist".

**The sync button reports that a sync is already running.** A previous run's ticket is still held.
A tick that is genuinely running clears it on its own; a ticket stranded by a crashed pod clears
when it expires, at `sync.schedule.timeout`. If that wait is unacceptable, and only after
confirming no worker is running — a second sync would start alongside the first:

```sql
update backstage_backend_tasks__tasks
   set current_run_ticket = null, current_run_started_at = null, current_run_expires_at = null
 where id = 'kubespec-sync';
```

**A project ingests no kinds.** The files were found and held no `apiextensions.k8s.io/v1` CRD.
Usually a `templates/` directory of Helm templates, or a project still shipping `v1beta1` CRDs.

**`No manifests at any of [...]`.** No candidate path resolved at that tag. Check the layout at
that specific tag — projects move their CRD directory, and `paths` is a list precisely so both
layouts can be listed at once.

**A version is missing while newer and older ones are there.** Its tag failed a rule. Test the
rules against the real tag list: `gh api repos/OWNER/REPO/tags --jq 'map(.name)'`. The usual cause
is `excludePrerelease` on a project whose stable releases carry a suffix, or a `regex` written
against the raw tag when it is applied after `prefix` is stripped.

**Kubernetes shows nothing.** `kubernetes.minors` is empty; without pinned minors the source is
skipped entirely rather than guessing which versions matter.
