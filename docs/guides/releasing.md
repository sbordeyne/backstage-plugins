# Releasing

Packages here are released by bumping a version. Merge a change to `master` that raises
`version` in a package's `package.json`, and the [Release workflow](https://github.com/sbordeyne/backstage-plugins/blob/master/.github/workflows/release.yaml)
publishes it to npm, tags the repository and opens a GitHub release.

```bash
# in the package being released
yarn version patch      # or minor / major
git commit -am "chore(gcp-provider): 0.2.0"
```

Nothing else is needed: there is no separate publish command to run, and no changelog file to
maintain.

## What the workflow does

1. **Verifies the whole repo** — `yarn tsc`, `yarn lint:all`, `yarn prettier:check`, `yarn test`,
   then `yarn build:all`. A broken package is worse than a late one, so nothing is published until
   all of that passes.
2. **Works out what to release** by asking the npm registry for each public workspace's current
   version. Anything the registry answers `404` for is released.
3. **Publishes** with `yarn workspace <name> npm publish --access public --tolerate-republish`.
4. **Tags** `<package-name>-<version>`, with the npm scope stripped — the
   `@sbordeyne/plugin-catalog-backend-module-gcp-provider` package at `0.2.0` is tagged
   `plugin-catalog-backend-module-gcp-provider-0.2.0`.
5. **Creates a GitHub release** on that tag, with notes listing the commits that touched that
   package's directory since its previous tag.

The registry, rather than the diff of the push, decides what to release. That matters: a re-run, a
squashed merge, or a run that failed halfway through thirteen packages all reach the same answer,
and a version that is already on npm is never republished.

## Setup

One repository secret is required:

| Secret      | What                                                                   |
| ----------- | ---------------------------------------------------------------------- |
| `NPM_TOKEN` | npm **automation** token with publish rights on the `@sbordeyne` scope |

Automation tokens bypass 2FA, which a granular or classic token does not — a publish from CI with
2FA enforced on the account fails without one. The workflow needs no other secret; tags and releases
use the `GITHUB_TOKEN` that Actions provides, which is why the job declares `contents: write`.

## Checking before releasing

The workflow can be run from the Actions tab with **dry run** ticked. It performs every check and
then lists what it would publish and which tags it would create, without touching npm or the
repository.

## When something goes wrong

**A package published but the tag is missing.** Re-run the workflow. The publish is skipped
(`--tolerate-republish`), and the tag and release are created on the second pass.

**One package fails, others succeed.** Each package is published, tagged and released
independently; the job reports the failure at the end but does not abandon the rest.

**The registry did not answer.** The run fails at the detection step rather than guessing. Nothing
is published — re-run it.

**A version was published by hand.** Nothing breaks. The registry check sees it and skips it, but
no tag or GitHub release is created for it. Tag it yourself if you want one:

```bash
git tag -a plugin-catalog-backend-module-gcp-provider-0.2.0 -m "…"
git push origin plugin-catalog-backend-module-gcp-provider-0.2.0
```

## What is not released

Anything marked `private: true` in its `package.json` — currently `packages/app` and
`packages/backend`, the demo Backstage instance this repo develops the plugins against.
