# Tech Insights: tech stack

`@sbordeyne/plugin-tech-insights-backend-module-stack`

A [Tech Insights](https://github.com/backstage/community-plugins/tree/main/workspaces/tech-insights)
fact retriever that reads build files straight out of a component's GitHub repository and reports
what it is built with: build tool, language version, framework and metrics library.

## Installation

```bash
yarn --cwd packages/backend add @sbordeyne/plugin-tech-insights-backend-module-stack
```

```ts
// packages/backend/src/index.ts
backend.add(import('@backstage-community/plugin-tech-insights-backend'));
backend.add(import('@sbordeyne/plugin-tech-insights-backend-module-stack'));
```

The module **throws at startup** when `integrations.github` is absent. Unlike the Jira module,
which degrades to registering nothing, there is no useful partial behaviour here: without a
GitHub integration the retriever cannot read a single file.

## Configuration

There is no config block of its own. Everything comes from the GitHub integration you already
have:

```yaml
integrations:
  github:
    - host: github.com
      token: ${GITHUB_TOKEN}
```

A GitHub App works equally well and is the better option for an organization — see
[Third-party integrations](../guides/integrations.md#github).

The credentials need read access to repository contents and metadata, nothing more:

| Credential       | What to grant                                                      |
| ---------------- | ------------------------------------------------------------------ |
| Classic PAT      | `repo` for private repositories; `public_repo` if all are public   |
| Fine-grained PAT | Repository permissions: **Contents: read**, **Metadata: read**     |
| GitHub App       | The same two repository permissions, installed on the organization |

## Linking a component to a repository

```yaml
# catalog-info.yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: users
  annotations:
    github.com/project-slug: my-org/users
spec:
  type: service
  owner: group:default/platform
```

Every `Component` gets a fact row. One with no `github.com/project-slug`, a malformed slug, or a
repository that cannot be read reports `hasGithubSlug` accordingly with `unknown` values, rather
than being skipped — so a check can distinguish "not annotated" from "annotated and plain".

## What it reads

Per component the retriever resolves the repository's default branch, then fetches these files
from it, all in parallel and all optional:

| File           | Detected as  | Yields                                                        |
| -------------- | ------------ | ------------------------------------------------------------- |
| `pom.xml`      | `maven`      | Java version, Spring Boot version, framework, metrics library |
| `build.gradle` | `gradle`     | Language version, framework, metrics library                  |
| `package.json` | `npm`/`yarn` | Node engine version, framework                                |
| `go.mod`       | `go`         | Go version                                                    |
| `yarn.lock`    | —            | Distinguishes `yarn` from `npm`                               |

The first file that exists wins, in that order: a repository with both a `pom.xml` and a
`package.json` reports as Maven. The primary language comes from GitHub's own repository
metadata, not from the files.

## Facts produced

Retriever id `stackFactRetriever`, entity filter `kind: component`.

| Fact                | Type    | Meaning                                                     |
| ------------------- | ------- | ----------------------------------------------------------- |
| `primaryLanguage`   | string  | Primary language as GitHub reports it, or `unknown`         |
| `buildTool`         | string  | `maven`, `gradle`, `npm`, `yarn`, `go` or `unknown`         |
| `languageVersion`   | string  | Language or runtime version from the build file             |
| `framework`         | string  | `spring-boot`, `express`, `nestjs` or `unknown`             |
| `metricsFramework`  | string  | `micrometer`, `prometheus-client` or `unknown`              |
| `springBootVersion` | string  | Spring Boot version when applicable, empty string otherwise |
| `hasSpringBoot`     | boolean | `framework` is `spring-boot`                                |
| `hasMicrometer`     | boolean | `metricsFramework` is `micrometer`                          |
| `hasGithubSlug`     | boolean | Component carries a usable `github.com/project-slug`        |

The booleans exist so a check can be written without string comparison, and so a failing check
reads as "no Micrometer" rather than "metricsFramework != micrometer".

## Cost and scheduling

Per component: one GitHub API call for the repository, then up to five raw file reads. A catalog
with 500 annotated components is roughly 3,000 requests per run. GitHub's authenticated REST
limit is 5,000 requests per hour for a PAT, so an hourly schedule with a large catalog will run
close to the ceiling — a GitHub App raises that limit substantially and is the right answer at
that scale. Otherwise schedule this daily; build files do not change hourly.

Failures are per component. A repository that 404s is logged and reported as `unknown`; the run
continues.

## Writing checks

The natural checks are policy statements about the fleet, gated on `hasGithubSlug` so that
unannotated components fail for the right reason:

```text
hasGithubSlug == true                      →  linked to a repository at all
hasMicrometer == true                      →  metrics library present
languageVersion in ['17', '21']            →  on a supported Java version
buildTool != 'unknown'                     →  build system recognised
```

## Troubleshooting

**Startup fails with `stackFactRetriever requires integrations.github`.** Add the integration;
this is deliberate.

**Everything is `unknown` but slugs are set.** The token cannot read the repositories, or the
files live somewhere other than the repository root. Only the root is checked — a service in a
monorepo subdirectory reports `unknown` and needs its own repository or a different approach.

**Rate limit errors.** Move to a GitHub App, or lengthen the schedule. Each component costs one
API call plus its file reads regardless of whether anything changed.
