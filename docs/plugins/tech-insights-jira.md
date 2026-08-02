# Tech Insights: Jira

`@sbordeyne/plugin-tech-insights-backend-module-jira`

A [Tech Insights](https://github.com/backstage/community-plugins/tree/main/workspaces/tech-insights)
fact retriever that produces per-component Jira health facts: open bugs, open blockers, open tech
debt, and average cycle time.

## Installation

```bash
yarn --cwd packages/backend add @sbordeyne/plugin-tech-insights-backend-module-jira
```

```ts
// packages/backend/src/index.ts
backend.add(import('@backstage-community/plugin-tech-insights-backend'));
backend.add(import('@sbordeyne/plugin-tech-insights-backend-module-jira'));
```

The module checks for `techInsights.jira` at startup. When it is missing it logs a warning and
registers nothing, rather than registering a retriever that would fail on every run.

## Configuration

```yaml
techInsights:
  jira:
    baseUrl: https://my-org.atlassian.net
    token: ${JIRA_TOKEN}
```

| Key       | Type   | Default      | Meaning                                                       |
| --------- | ------ | ------------ | ------------------------------------------------------------- |
| `baseUrl` | string | **required** | Jira Cloud site URL, without a trailing path                  |
| `token`   | string | **required** | Base64 of `email:api-token`, sent as an HTTP Basic credential |

`token` is **not** the raw API token. It is the base64 of `email:api-token`, which is what
`Authorization: Basic` expects:

```bash
# Create an API token at https://id.atlassian.com/manage-profile/security/api-tokens
printf '%s' 'me@example.com:ATATT3xFfGF0...' | base64
```

Put the result in an environment variable and reference it from config; never commit it.

!!! note "Jira Cloud only"

    The client calls `/rest/api/3/…`, which is the Jira Cloud REST API. A Jira Server or Data
    Center instance exposes `/rest/api/2` and will 404 on every request.

The account behind the token needs **Browse Projects** on every project you expect facts for. A
project it cannot see is indistinguishable from one that does not exist, and is reported as
having no Jira project rather than failing the run.

## Linking a component to a project

```yaml
# catalog-info.yaml
apiVersion: backstage.io/v1alpha1
kind: Component
metadata:
  name: users
  annotations:
    jira/project-key: USERS
spec:
  type: service
  owner: group:default/platform
```

Every `Component` in the catalog gets a fact row. A component with no `jira/project-key`, or one
whose project cannot be read, gets `hasJiraProject: false` and zeroes — so a check can tell an
unlinked component from a healthy one instead of treating both as fine.

## Facts produced

Retriever id `jiraFactRetriever`, entity filter `kind: component`.

| Fact                  | Type    | Meaning                                                      |
| --------------------- | ------- | ------------------------------------------------------------ |
| `hasJiraProject`      | boolean | Component is linked to a readable Jira project               |
| `openBugCount`        | integer | Unresolved issues of type `Bug`                              |
| `openBlockerBugCount` | integer | Unresolved `Bug`s with priority `Blocker` or `Critical`      |
| `openTechDebtCount`   | integer | Unresolved issues of type `Tech Debt` or `Improvement`       |
| `avgCycleTimeDays`    | float   | Mean days from creation to resolution, over the last 90 days |
| `jiraProjectKey`      | string  | The project key the facts were read from                     |

The JQL behind each fact, for when a number does not look right:

```sql
-- openBugCount
project = "KEY" AND issuetype = Bug AND resolution = Unresolved

-- openBlockerBugCount
project = "KEY" AND issuetype = Bug
  AND priority in (Blocker, Critical) AND resolution = Unresolved

-- openTechDebtCount
project = "KEY" AND issuetype in ("Tech Debt", Improvement) AND resolution = Unresolved

-- avgCycleTimeDays, over at most 100 issues
project = "KEY" AND resolution = Done AND resolutiondate >= -90d
```

Those issue type and priority names are Jira defaults. An instance that renamed `Tech Debt`,
dropped the `Critical` priority or uses a different `Done` resolution will report zeroes for the
affected facts — the queries are not configurable today.

`avgCycleTimeDays` samples at most 100 resolved issues, so on a high-throughput project it is an
estimate over a recent sample rather than a full mean. Negative durations, which Jira can
produce when a resolution date precedes creation, are discarded.

## Cost and scheduling

The retriever iterates every `Component` in the catalog and issues, per linked component, one
project lookup plus four searches. A catalog with 500 linked components is 2,500 Jira API calls
per run — well inside Jira Cloud's rate limits at an hourly cadence, and not at a five-minute
one. Schedule it with the fact retriever registration options of the Tech Insights backend, and
keep the frequency in hours.

## Writing checks

Facts are consumed by whichever fact checker your Tech Insights backend registers. Reference the
fact ids above from that checker's rules; for the JSON-rules checker, `hasJiraProject` is the
one to gate on first, so unlinked components fail for the right reason:

```text
hasJiraProject == true  →  linked at all
openBlockerBugCount == 0  →  no blocking bugs open
avgCycleTimeDays < 14   →  issues close within a fortnight
```

## Troubleshooting

**Nothing is registered.** The startup log says `techInsights.jira config not found`. Add the
config block; the module deliberately does not register a retriever it knows will fail.

**Everything reports `hasJiraProject: false`.** Either the annotation is missing, or the token's
account cannot browse the project. The retriever logs `project not found` per component with the
key it tried.

**All counts are zero on a busy project.** Check the issue type and priority names in that Jira
instance against the JQL above.
