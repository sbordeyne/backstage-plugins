# @sbordeyne/kubespec-common

## 0.2.0

### Minor Changes

- 576b958: Add kubespec: a browsable reference for the Kubernetes API and for the CRDs of the operators you run.

  A scheduled worker fetches OpenAPI specs and CRD manifests from GitHub, expands them into
  schema trees and stores them; the page then renders from the database rather than from
  upstream. Sources are declared in `app-config.yaml` — the core API is pinned to explicit
  minor versions, and every other project selects its releases with declarative tag rules.

  The page lists each kind by category, renders its schema as a keyboard-navigable tree with
  a filter, and shows what changed in it release by release, alongside hand-authored examples
  and links.

  Ingest is cheap to repeat: a version's fingerprint comes from the blob shas in its
  directory listing, so an unchanged version is skipped before anything is downloaded, and
  manifest bodies are fetched from raw.githubusercontent.com, which costs no API quota.
