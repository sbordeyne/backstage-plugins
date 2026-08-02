# integrated-repositories

Tracks how much of your GitHub organization is covered by the Backstage catalog.

The plugin exposes a single page, `IntegratedRepositoriesPage`, mounted at
`/integrated-repositories` by your Backstage app.

## How coverage is determined

The `github` catalog provider is configured with `catalogPath: '**/catalog-info.yaml'` and leaves
`validateLocationsExist` at its default of `false`, so it emits a `Location` entity for **every**
repository in the organization — archived repositories, forks and empty repositories excluded — no
matter whether a `catalog-info.yaml` actually exists.

That makes the set of `generated-*` `Location` entities the full repository inventory, and it makes
the presence of a `Location` meaningless on its own. What proves integration is whether a location
produced entities, which is resolved through two annotations:

| Annotation                                | Meaning                                                            |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `backstage.io/managed-by-origin-location` | The provider's glob target — equals the `Location`'s `spec.target` |
| `backstage.io/managed-by-location`        | The concrete file the entity was read from                         |

## Why GitHub is queried too

Three facts are not derivable from the catalog:

- **The primary language.** `metadata.labels.language` only exists on entities that were already
  ingested, so it cannot classify the uncovered repositories — which is exactly the population that
  needs classifying.
- **Drift.** A `Location` is emitted whether or not the file exists, and its `presence` is
  `optional`, so an unmatched glob records no error at all.
- **Recency**, needed to rank the uncovered repositories into a worklist.

A single GraphQL query per organization adds `primaryLanguage`, `pushedAt`, visibility and a
root-`catalog-info.yaml` check. It authenticates through `scmAuthApiRef`, which is already
registered by default in a Backstage app, so no extra secret or OAuth scope is required.

Enrichment is best effort. When it fails the page still renders from the catalog alone: the language
selector is disabled so the scope stays the whole organization, uningested repositories are reported
as `unknown`, and the worklist is hidden.

## Status model

| Status              | Meaning                                                    |
| ------------------- | ---------------------------------------------------------- |
| `integrated`        | Entities produced from a root `catalog-info.yaml`          |
| `integrated-nested` | Entities produced, but only from nested paths (a monorepo) |
| `drift`             | A root `catalog-info.yaml` exists but produced no entities |
| `not-integrated`    | No file and no entities                                    |
| `unknown`           | No entities, and GitHub could not be reached               |

The binary _integrated / not integrated_ filter treats both `integrated` statuses as covered.

## Scoping by primary language

The coverage KPI and the table are both scoped by a multi-select of GitHub's `primaryLanguage`,
seeded from `integratedRepositories.defaultLanguages` (empty by default — see
[Configuration](#configuration)). An empty selection means all repositories rather than none, so
clearing the control never blanks the page, and repositories where GitHub reports no language are
selectable through an explicit **Unknown** option. Repositories outside the selection stay one click
away behind **Show other languages**, where they appear marked, so the page still lists the whole
organization.

Language is a coarse heuristic: a polyglot repository whose primary language resolves to YAML or
Shell falls outside a selection of the languages it is mostly written in.

## Loading

The page loads in three independent stages so each part renders as soon as its own data arrives,
rather than everything waiting on the slowest leg:

| Stage      | Source                                | Fills in                                                     |
| ---------- | ------------------------------------- | ------------------------------------------------------------ |
| Inventory  | one small catalog query               | the repository list, so the table appears almost immediately |
| Ingestion  | catalog, chunked by origin annotation | integration status, entity counts, the KPI                   |
| Enrichment | GitHub GraphQL, pages are sequential  | language, last push, visibility, drift                       |

Ingestion and enrichment depend only on the inventory and run concurrently. Cells and figures whose
stage is still pending render as skeletons instead of showing a misleading value, and the table dims
while it is refreshing. GitHub responses are cached in memory for five minutes; the **Refresh**
button clears that cache and re-runs the enrichment stage.

The table reveals rows 20 at a time as you scroll. `@backstage/ui` has no infinite scroll, so the
component owns the accumulation and drives it from an `IntersectionObserver`; a **Show more
repositories** button is the accessible equivalent and the fallback when no observer fires.

## Configuration

Everything the page needs is derived from the catalog and the configured GitHub integration, so
there is nothing to configure to get it working. One optional key pins the initial language filter:

```yaml
integratedRepositories:
  # Selected on first load, matched case-insensitively against the languages GitHub reports.
  # Only languages that actually occur are selected; if none do, the selection stays empty,
  # which means "all languages". Defaults to [].
  defaultLanguages: ['Java', 'Kotlin']
```

Pin it when the headline coverage figure should cover a fixed perimeter and stay comparable over
time; leave it unset to report on every repository.

## Development

```bash
yarn workspace @sbordeyne/backstage-plugin-integrated-repositories start   # isolated dev harness
yarn workspace @sbordeyne/backstage-plugin-integrated-repositories test
```

The dev harness renders the page against stubbed APIs, including a variant where the GitHub stub
rejects so the degraded path can be checked.

## Notes

- The status column renders coloured text rather than a `Tag`, because `@backstage/ui`'s `Tag` has
  no colour variants.
- The coverage bar is two nested `Box`es with hand-written ARIA, because `@backstage/ui` ships no
  meter or progress component and `Box` has no border-radius prop.
- `Flex` cannot wrap, so wrapping rows use either `Grid.Root` or an explicit `flexWrap` style.
