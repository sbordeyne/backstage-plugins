# Backstage plugins

Backstage plugins built for my own platform and published for anyone who has the same
problem. Each one is installable on its own; nothing here depends on anything else in this
repository except the shared packages a plugin pair uses between its own halves.

## What is here

| Plugin                                                        | Kind                   | What it does                                                                            |
| ------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------- |
| [GCP catalog provider](plugins/gcp-catalog-provider.md)       | catalog backend module | Ingests 58 kinds of GCP resource, and the IAM edges between them, as a dependency graph |
| [Bruno](plugins/bruno.md)                                     | frontend + backend     | Shows Bruno API test runs, synced from a GCS bucket, on the owning entity               |
| [Secure Share](plugins/secure-share.md)                       | frontend + backend     | End-to-end encrypted, short-lived sharing of credentials, text and files                |
| [Integrated repositories](plugins/integrated-repositories.md) | frontend               | Tracks how much of a GitHub organization the catalog actually covers                    |
| [Tech Insights: Jira](plugins/tech-insights-jira.md)          | tech-insights module   | Per-component Jira health facts: bugs, blockers, tech debt, cycle time                  |
| [Tech Insights: stack](plugins/tech-insights-stack.md)        | tech-insights module   | Detects build tool, language version, framework and metrics library from GitHub         |
| [Go template playground](plugins/gotemplate-playground.md)    | toolbox module         | Renders Go templates against the sprig, sprout, helm and external-secrets function sets |
| [Should I deploy today?](plugins/should-i-deploy-today.md)    | frontend               | Home page widget answering the question from the weekday, the hour and public holidays  |

Two cross-cutting guides cover the setup that is shared between them:

- **[GCP permissions](guides/gcp-permissions.md)** — service accounts, IAM roles per provider,
  and the GKE-specific setup, with `gcloud` and Terraform for each.
- **[Third-party integrations](guides/integrations.md)** — the `app-config.yaml` blocks the
  plugins read: GitHub, Jira, Google Cloud credentials and the database.

## Compatibility

| Requirement | Version                                     |
| ----------- | ------------------------------------------- |
| Backstage   | 1.53.1 (built and tested against this line) |
| Node.js     | 20 or 22                                    |
| Backend     | New backend system only (`createBackend()`) |

All backend packages are backend-system plugins or modules. None of them ship a legacy
`createRouter` wiring for the old backend, so an app still on the legacy backend cannot install
them without porting first.

## Installing

Every package is published under the `@sbordeyne` scope. Frontend packages go into
`packages/app`, backend packages and modules into `packages/backend`:

```bash
# Frontend plugin
yarn --cwd packages/app add @sbordeyne/backstage-plugin-secure-share

# Backend plugin or module
yarn --cwd packages/backend add @sbordeyne/backstage-plugin-secure-share-backend
```

Backend plugins are then added to the backend, and pick up their configuration from
`app-config.yaml` on their own:

```ts
// packages/backend/src/index.ts
backend.add(import('@sbordeyne/backstage-plugin-secure-share-backend'));
```

Frontend plugins need to be mounted somewhere — a route, an entity tab or a home card,
depending on the plugin. Each plugin page shows exactly where.

Plugins that store data (`bruno-backend`, `secure-share-backend`) run their own migrations at
startup against the database the backend hands them, so there is no migration step to run by
hand. They honour `backend.database.migrations.skip` if you manage schema yourself.

## Running the plugins locally

The repository carries its own throwaway Backstage app in `packages/app` and `packages/backend`,
so a plugin can be exercised without wiring it into a real instance:

```bash
yarn install
yarn start          # backend on :7007, frontend on :3000
```

It runs on an in-memory SQLite database with guest auth, so it needs no credentials and keeps no
state between runs. `examples/entities.yaml` supplies a component to hang entity-scoped tabs off.

The app uses the **new frontend system**, because the toolbox module requires it. The three
legacy-system frontend plugins are adapted in `packages/app/src/App.tsx` with `convertLegacyPlugin`
and `compatWrapper`.

Backend plugins that need third-party credentials — the GCP catalog provider, `bruno-backend` and
the two tech-insights modules — are listed but commented out in `packages/backend/src/index.ts`.
Put their credentials in `app-config.local.yaml` and uncomment the one you want.

!!! note "The Go template playground needs its engine built first"

    ```bash
    yarn workspace @sbordeyne/backstage-plugin-toolbox-module-gotemplate build:wasm
    cp plugins/toolbox-module-gotemplate/static/gotemplate.wasm packages/app/public/
    ```

    The dev app serves it from `/gotemplate.wasm` rather than the public CDN. It is 83 MB and is
    deliberately not committed.

## Configuration schemas

Backend packages that read configuration declare a `config.d.ts` schema, so
`backstage-cli config:check` validates your `app-config.yaml` against them and
`@visibility frontend` keys are the only ones served to the browser. Nothing marked frontend
visible in these plugins carries a secret — storage buckets, tokens and credentials are all
backend-only by construction.

## Conventions used in these docs

- YAML blocks are fragments of `app-config.yaml` unless stated otherwise, shown at their real
  nesting depth.
- Every option table lists the default. An option with no default is required, and the plugin
  fails loudly at startup rather than guessing.
- `gcloud` examples assume `PROJECT_ID` is set; Terraform examples assume the `google` provider
  is already configured for that project.
