# Third-party integrations

Every external system these plugins touch is configured in `app-config.yaml`. This page collects
those blocks in one place: what to create on the third-party side, what the plugin reads, and
what it does when the credential is wrong.

## Config key index

| Config key                 | Read by                                                                                                                     | Required                    |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `catalog.providers.gcp`    | [GCP catalog provider](../plugins/gcp-catalog-provider.md)                                                                  | to ingest anything          |
| `catalog.providers.github` | [Integrated repositories](../plugins/integrated-repositories.md)                                                            | yes                         |
| `integrations.github`      | [Integrated repositories](../plugins/integrated-repositories.md), [Tech Insights: stack](../plugins/tech-insights-stack.md) | yes                         |
| `techInsights.jira`        | [Tech Insights: Jira](../plugins/tech-insights-jira.md)                                                                     | yes                         |
| `bruno`                    | [Bruno](../plugins/bruno.md)                                                                                                | no — all defaulted          |
| `secureShare`              | [Secure Share](../plugins/secure-share.md)                                                                                  | no — all defaulted          |
| `integratedRepositories`   | [Integrated repositories](../plugins/integrated-repositories.md)                                                            | no                          |
| `kubernetes`               | GKE cluster entities, via the Kubernetes plugin                                                                             | only for the Kubernetes tab |

Backend packages declare their schema in `config.d.ts`, so `yarn backstage-cli config:check`
validates all of the above and tells you which key is wrong rather than failing at runtime.

## GitHub

Used by two plugins, in two different ways:

- **Tech Insights: stack** reads build files from the backend, using `integrations.github`.
- **Integrated repositories** queries GitHub's GraphQL API _from the browser_, authenticating
  through `scmAuthApiRef` with the signed-in user's GitHub session. It reads
  `integrations.github` only to know which host is configured.

```yaml
integrations:
  github:
    - host: github.com
      token: ${GITHUB_TOKEN}
```

A GitHub App is the better option for an organization — higher rate limits, no personal
credential, and no re-issuing when somebody leaves:

```yaml
integrations:
  github:
    - host: github.com
      apps:
        - $include: github-app-credentials.yaml
```

Generate that file with `yarn backstage-cli create-github-app <org>`, which walks through the
app creation and writes the credentials out.

Permissions needed, whichever you use:

| Credential       | Grant                                                            |
| ---------------- | ---------------------------------------------------------------- |
| Classic PAT      | `repo` for private repositories, `public_repo` if all are public |
| Fine-grained PAT | Repository permissions: **Contents: read**, **Metadata: read**   |
| GitHub App       | The same two repository permissions, installed org-wide          |

For the coverage page, also configure GitHub authentication for users, since the query runs in
their browser:

```yaml
auth:
  providers:
    github:
      development:
        clientId: ${AUTH_GITHUB_CLIENT_ID}
        clientSecret: ${AUTH_GITHUB_CLIENT_SECRET}
```

### The catalog provider

Coverage reporting depends on how the `github` catalog provider is configured — a glob
`catalogPath` with `validateLocationsExist` left at its default is what makes uncovered
repositories visible at all:

```yaml
catalog:
  providers:
    github:
      myOrg:
        organization: my-org
        catalogPath: '**/catalog-info.yaml'
        filters:
          branch: main
        schedule:
          frequency: { hours: 1 }
          timeout: { minutes: 30 }
```

### Rate limits

The stack fact retriever costs one API call plus up to five file reads per annotated component,
every run. A PAT is capped at 5,000 requests per hour; a GitHub App installation is
substantially higher. With a few hundred components, either move to an App or schedule the
retriever daily.

## Jira

Jira Cloud only — the client calls `/rest/api/3/…`, which Server and Data Center do not expose.

```yaml
techInsights:
  jira:
    baseUrl: https://my-org.atlassian.net
    token: ${JIRA_TOKEN}
```

`token` is the base64 of `email:api-token`, not the raw token:

```bash
# Token from https://id.atlassian.com/manage-profile/security/api-tokens
printf '%s' 'me@example.com:ATATT3xFfGF0...' | base64
```

The account needs **Browse Projects** on every project you want facts for. A project it cannot
see reports as absent rather than failing the run, so a silent wave of `hasJiraProject: false`
usually means permissions rather than annotations.

Prefer a service account over a personal one: facts quietly stop being collected the day a
person's token is revoked.

## Google Cloud

All three GCP-backed plugins use Application Default Credentials, so there is no credential in
`app-config.yaml` at all — only bucket names and project ids.

```yaml
catalog:
  providers:
    gcp:
      defaultOwner: group:default/platform
      bigquery:
        projects: [my-project]
        schedule: { frequency: { hours: 1 }, timeout: { minutes: 10 } }

bruno:
  bucket: my-ci-artifacts
  objectPrefix: ui_tests/reports/bruno/

secureShare:
  storage:
    type: gcs
    gcs:
      bucket: example-secure-share
      prefix: pastes/
```

The credential is supplied by the environment: Workload Identity on GKE, the attached service
account on Cloud Run or GCE, or `GOOGLE_APPLICATION_CREDENTIALS` pointing at a key file. See
[GCP permissions](gcp-permissions.md) for the roles and how to grant them.

Secure Share can override this for its bucket alone with `secureShare.storage.gcs.keyFilename`,
which is useful when the chunk bucket lives in a different project from everything else.

## Kubernetes

GKE cluster entities are only useful if the Kubernetes plugin is told to take clusters from the
catalog:

```yaml
kubernetes:
  serviceLocatorMethod:
    type: multiTenant
  clusterLocatorMethods:
    - type: catalog
```

The cluster entities carry the API server URL, CA certificate and auth provider as annotations,
so no per-cluster configuration is needed here. In-cluster RBAC still is —
see [GKE and the Kubernetes plugin](gcp-permissions.md#gke-and-the-kubernetes-plugin).

## Database

Bruno and Secure Share store data and run their own migrations at startup. SQLite in memory is
the Backstage default and is fine for local development; anything with more than one replica
needs PostgreSQL:

```yaml
backend:
  database:
    client: pg
    connection:
      host: ${POSTGRES_HOST}
      port: ${POSTGRES_PORT}
      user: ${POSTGRES_USER}
      password: ${POSTGRES_PASSWORD}
```

Each plugin gets its own logical database, named after its plugin id, exactly as any other
Backstage plugin. To manage schema yourself, set `backend.database.migrations.skip` — both
plugins honour it and will then expect the tables to already exist.

Secure Share's `storage.type: local` writes chunks to the backend's filesystem and is
single-replica only; the database being shared does not make the blob directory shared. Use GCS
for anything beyond development.

## A complete example

Everything at once, for an installation running all six plugins:

```yaml
integrations:
  github:
    - host: github.com
      token: ${GITHUB_TOKEN}

auth:
  providers:
    github:
      production:
        clientId: ${AUTH_GITHUB_CLIENT_ID}
        clientSecret: ${AUTH_GITHUB_CLIENT_SECRET}

backend:
  database:
    client: pg
    connection:
      host: ${POSTGRES_HOST}
      port: ${POSTGRES_PORT}
      user: ${POSTGRES_USER}
      password: ${POSTGRES_PASSWORD}

catalog:
  providers:
    github:
      myOrg:
        organization: my-org
        catalogPath: '**/catalog-info.yaml'
        filters:
          branch: main
        schedule:
          frequency: { hours: 1 }
          timeout: { minutes: 30 }

    gcp:
      defaultOwner: group:default/platform
      defaultRegion: europe-west1

      service-account:
        projects: [my-project]
        schedule: { frequency: { hours: 1 }, timeout: { minutes: 10 } }
      bigquery:
        projects: [my-project]
        schedule: { frequency: { hours: 1 }, timeout: { minutes: 10 } }
      pubsub:
        projects: [my-project]
        stripPrefixes: ['myorg-', 'prod-']
        schedule: { frequency: { hours: 1 }, timeout: { minutes: 10 } }
      cloudsql:
        projects: [my-project]
        schedule: { frequency: { hours: 6 }, timeout: { minutes: 10 } }
      storage:
        projects: [my-project]
        schedule: { frequency: { hours: 6 }, timeout: { minutes: 15 } }
      secretmanager:
        projects: [my-project]
        schedule: { frequency: { hours: 6 }, timeout: { minutes: 10 } }
      clusters:
        projects: [my-project]
        schedule: { frequency: { hours: 1 }, timeout: { minutes: 10 } }

kubernetes:
  serviceLocatorMethod:
    type: multiTenant
  clusterLocatorMethods:
    - type: catalog

techInsights:
  jira:
    baseUrl: https://my-org.atlassian.net
    token: ${JIRA_TOKEN}

integratedRepositories:
  defaultLanguages: ['Java', 'Kotlin']

bruno:
  bucket: my-ci-artifacts
  objectPrefix: ui_tests/reports/bruno/
  retention:
    runsPerEntity: 20
  sync:
    maxArtifactAge: { days: 30 }
    schedule:
      frequency: { minutes: 15 }
      timeout: { minutes: 10 }

secureShare:
  expiration:
    default: { hours: 24 }
    max: { days: 7 }
  limits:
    maxFileSize: 100MB
  storage:
    type: gcs
    gcs:
      bucket: example-secure-share
      prefix: pastes/
  cleanup:
    frequency: { minutes: 10 }
```

## Secrets

Nothing above should hold a literal credential. Backstage substitutes `${VAR}` from the
environment, so keep the values in whatever secret store you already run and inject them there.

Of the config in this repository, exactly three keys are secret — `integrations.github.token`,
`techInsights.jira.token` and the GitHub auth client secret. The GCP plugins hold none, because
credentials reach them through the environment rather than through config. No key marked
`@visibility frontend` in any of these plugins carries a secret, so the config served to the
browser stays free of them by construction.
