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

Three jobs:

| Job        | Scope       | What                                                                    |
| ---------- | ----------- | ----------------------------------------------------------------------- |
| `discover` | repo        | Asks npm which workspace versions are unreleased, and builds the matrix |
| `verify`   | repo        | `yarn tsc`, `yarn lint:all`, `yarn prettier:check`, `yarn test`         |
| `release`  | **package** | One matrix job per package being released                               |

`verify` is repo-wide because those checks are: the repo shares a single `tsconfig.json`, and
formatting covers docs and workflows as well as source. Nothing reaches npm until it passes — a
broken package is worse than a late one.

Each release job then, for its own package:

1. **Builds and packs** it with `yarn`. Yarn does the packing because it is the only tool here that
   resolves the `backstage:` protocol into real semver ranges; `npm publish` on the source directory
   would ship `backstage:^` verbatim, which nobody can install. `prepack` also needs the build,
   since it rewrites the manifest to point at `dist/`.
2. **Publishes the tarball** with `npm publish`, authenticating through
   [trusted publishing](#trusted-publishing).
3. **Tags** `<package-name>-<version>`, with the npm scope stripped — the
   `@sbordeyne/plugin-catalog-backend-module-gcp-provider` package at `0.2.0` is tagged
   `plugin-catalog-backend-module-gcp-provider-0.2.0`.
4. **Creates a GitHub release** on that tag, with notes listing the commits that touched that
   package's directory since its previous tag.

The matrix runs with `fail-fast: false`: one package failing to publish says nothing about the
others, and a package whose trusted publisher is not configured yet should not hold up the rest.

The registry, rather than the diff of the push, decides what to release. That matters: a re-run, a
squashed merge, or a run where one package's publish failed all reach the same answer, and a version
already on npm is never republished.

## Trusted publishing

There is **no npm token anywhere**. Each package is configured on npm with a trusted publisher
pointing at this repository and at `.github/workflows/release.yaml`, and npm exchanges the
workflow's OIDC token for a short-lived publish credential. Provenance is generated as part of that.

Three things have to hold, or publishing fails:

- The release job declares `id-token: write`. Without it there is no OIDC token to exchange.
- The workflow file stays at `.github/workflows/release.yaml`. The trusted publisher is bound to
  that filename, so renaming or moving the workflow breaks publishing for every package.
- The npm CLI is at least 11.5.1, which is the first version that can do the exchange. The job
  installs a current npm rather than using the one bundled with Node.

A new package needs its trusted publisher configured on npm before its first release; until then its
matrix job fails on authentication while the others publish normally.

Tags and GitHub releases use the `GITHUB_TOKEN` Actions provides, which is why the job also declares
`contents: write`.

## Checking before releasing

The workflow can be run from the Actions tab with **dry run** ticked. `discover` still lists what it
would publish, and which tags it would create, in the run summary — the release jobs are skipped.

## When something goes wrong

**A package published but the tag is missing.** Re-run the failed job. `discover` no longer lists
that package — it is on npm now — so re-run the whole workflow only after bumping, or create the tag
by hand as below.

**One package fails, others succeed.** Each package has its own matrix job, so the rest carry on and
only the failed one needs looking at. A failure on `npm publish` with an authentication error means
that package has no trusted publisher configured yet.

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
