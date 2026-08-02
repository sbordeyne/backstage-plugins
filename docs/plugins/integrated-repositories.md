# Integrated repositories

`@sbordeyne/backstage-plugin-integrated-repositories`

A single page that tracks how much of your GitHub organization the catalog actually covers, and
turns the gap into a worklist. Frontend only — there is no backend package to install.

## How coverage is determined

The `github` catalog provider, configured with a glob `catalogPath` and left at the default
`validateLocationsExist: false`, emits a `Location` entity for **every** repository in the
organization — archived repositories, forks and empty repositories excluded — whether or not a
`catalog-info.yaml` exists.

That makes the set of `generated-*` `Location` entities the full repository inventory, and it
makes the presence of a `Location` meaningless on its own. What proves integration is whether a
location produced entities, resolved through two annotations:

| Annotation                                | Meaning                                                            |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `backstage.io/managed-by-origin-location` | The provider's glob target — equals the `Location`'s `spec.target` |
| `backstage.io/managed-by-location`        | The concrete file the entity was read from                         |

GitHub is queried as well, because three facts are not derivable from the catalog: the primary
language of repositories that were never ingested, drift (a `catalog-info.yaml` that exists but
produced nothing), and recency for ranking the worklist. One GraphQL query per organization
covers it, authenticated through `scmAuthApiRef`, which a Backstage app already registers — so
no extra secret or OAuth scope is required.

Enrichment is best effort. When GitHub cannot be reached the page still renders from the catalog
alone: the language selector is disabled, uningested repositories report as `unknown`, and the
worklist is hidden.

### Status model

| Status              | Meaning                                                    |
| ------------------- | ---------------------------------------------------------- |
| `integrated`        | Entities produced from a root `catalog-info.yaml`          |
| `integrated-nested` | Entities produced, but only from nested paths (a monorepo) |
| `drift`             | A root `catalog-info.yaml` exists but produced no entities |
| `not-integrated`    | No file and no entities                                    |
| `unknown`           | No entities, and GitHub could not be reached               |

The binary _integrated / not integrated_ filter treats both `integrated` statuses as covered.

## Installation

```bash
yarn --cwd packages/app add @sbordeyne/backstage-plugin-integrated-repositories
```

```tsx
// packages/app/src/App.tsx
import { IntegratedRepositoriesPage } from '@sbordeyne/backstage-plugin-integrated-repositories';

<Route path="/integrated-repositories" element={<IntegratedRepositoriesPage />} />;
```

```tsx
// packages/app/src/components/Root/Root.tsx
<SidebarItem icon={ExtensionIcon} to="integrated-repositories" text="Coverage" />
```

## Prerequisites

The page reads what the catalog and the GitHub integration already give it, so the work is in
having those set up correctly rather than in configuring this plugin.

### The GitHub catalog provider

Coverage only means anything if the provider emits a `Location` per repository. That is what a
glob `catalogPath` with the default `validateLocationsExist` does:

```yaml
catalog:
  providers:
    github:
      myOrg:
        organization: my-org
        # A glob, so a Location is emitted for every repository, matched or not.
        catalogPath: '**/catalog-info.yaml'
        filters:
          branch: main
        schedule:
          frequency: { hours: 1 }
          timeout: { minutes: 30 }
```

Setting `validateLocationsExist: true` makes the provider skip repositories with no
`catalog-info.yaml` — which removes exactly the population this page exists to report on.

### The GitHub integration

```yaml
integrations:
  github:
    - host: github.com
      token: ${GITHUB_TOKEN}
```

The browser's GraphQL query authenticates through `scmAuthApiRef`, so what matters at runtime is
that your app has a GitHub auth provider configured for the signed-in user. See
[Third-party integrations](../guides/integrations.md#github) for both halves.

## Configuration

Everything needed is derived from the catalog and the GitHub integration, so nothing has to be
configured for the page to work. One optional key pins the initial language filter:

```yaml
integratedRepositories:
  # Selected on first load, matched case-insensitively against the languages GitHub reports.
  # Only languages that actually occur are selected; if none do, the selection stays empty,
  # which means "all languages". Defaults to [].
  defaultLanguages: ['Java', 'Kotlin']
```

| Key                | Type     | Default | Frontend visible | Meaning                                |
| ------------------ | -------- | ------- | ---------------- | -------------------------------------- |
| `defaultLanguages` | string[] | `[]`    | yes              | Languages selected when the page loads |

Pin it when the headline coverage figure should cover a fixed perimeter and stay comparable over
time; leave it unset to report on every repository.

Language is a coarse heuristic: a polyglot repository whose primary language resolves to YAML or
Shell falls outside a selection of the languages it is mostly written in. Repositories outside
the selection stay one click away behind **Show other languages**, where they appear marked, so
the page still lists the whole organization.

## How the page loads

Three independent stages, so each part renders as soon as its own data arrives rather than
everything waiting on the slowest leg:

| Stage      | Source                                | Fills in                                                     |
| ---------- | ------------------------------------- | ------------------------------------------------------------ |
| Inventory  | one small catalog query               | the repository list, so the table appears almost immediately |
| Ingestion  | catalog, chunked by origin annotation | integration status, entity counts, the KPI                   |
| Enrichment | GitHub GraphQL, pages are sequential  | language, last push, visibility, drift                       |

Ingestion and enrichment depend only on the inventory and run concurrently. Cells whose stage is
still pending render as skeletons rather than showing a misleading value. GitHub responses are
cached in memory for five minutes; **Refresh** clears that cache and re-runs enrichment.

## Troubleshooting

**Coverage reads 100% and the table is short.** The provider is validating locations, so
uncovered repositories were never emitted. Remove `validateLocationsExist: true`.

**Every repository is `unknown`.** The GitHub enrichment leg failed — usually the signed-in user
has no GitHub auth session, or the organization is outside the token's scope. The catalog-only
view still tells you which locations produced entities.

**A monorepo shows as `integrated-nested`.** Entities were produced, but only from nested paths;
there is no root `catalog-info.yaml`. That is a real distinction, not a bug — the binary filter
counts it as covered.
