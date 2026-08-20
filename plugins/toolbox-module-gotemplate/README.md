# Go template playground for Backstage Toolbox

Adds a **Go template playground** to [`@drodil/backstage-plugin-toolbox`][toolbox],
with a switch between four function sets:

| Set                  | Backed by                                                    |
| -------------------- | ------------------------------------------------------------ |
| **Sprig**            | `github.com/Masterminds/sprig/v3`                            |
| **Sprout**           | `github.com/go-sprout/sprout` (native registries)            |
| **Helm**             | `helm.sh/helm/v3/pkg/engine` — helm's actual template engine |
| **External Secrets** | `external-secrets/runtime/template/v2`                       |

Templates are rendered by **Go's real `text/template`**, compiled to WebAssembly —
not by a JavaScript reimplementation. What the playground prints is what the
corresponding tool prints, including error messages and edge-case behaviour.

## Why that matters

The four sets are genuinely not interchangeable, and the playground shows it:

- Sprout **renamed** most of sprig's functions. `upper` is `toUpper`,
  `b64enc` is `base64Encode`, `kebabcase` is `toKebabCase`. A sprig template
  pasted into the sprout tab fails, exactly as it would in production.
- Helm removes `env` and `expandenv`, and adds `include`, `tpl`, `required`,
  `toYaml` and the `.Release` / `.Chart` / `.Capabilities` context.
- External Secrets forces `missingkey=error` and hands the template a **flat**
  `map[string]string` of secret keys — there is no `.Values` nesting — plus its
  own PKCS12/JWK/PEM helpers.

Each tab loads a sample written to demonstrate that set's specifics, and the
function reference lists what that set actually exposes.

## Install

```bash
yarn --cwd packages/app add @sbordeyne/backstage-plugin-toolbox-module-gotemplate
```

Register the module alongside the toolbox plugin in `packages/app/src/App.tsx`
(or wherever you call `createApp`):

```ts
import toolboxPlugin from '@drodil/backstage-plugin-toolbox';
import gotemplateModule from '@sbordeyne/backstage-plugin-toolbox-module-gotemplate';

export const app = createApp({
  features: [
    toolboxPlugin,
    gotemplateModule,
    // ...
  ],
});
```

The tool then appears in the toolbox under **Miscellaneous → Go template
playground**, and is reachable by the aliases `gotemplate`, `sprig`, `sprout`,
`helm` and `eso`.

> This module targets toolbox **v2**, which requires Backstage's new frontend
> system.

## Serving the engine

The engine is a single WebAssembly module: **~83 MB raw, ~14 MB gzipped**. That
is the price of running the genuine helm and external-secrets code paths, which
pull in `client-go` and `apimachinery`. It is fetched lazily — only when someone
opens the tool — and then cached by the browser.

By default it is fetched from the GitHub release matching the installed
package version, where CI attaches it as a release asset:

```
https://github.com/sbordeyne/backstage-plugins/releases/download/backstage-plugin-toolbox-module-gotemplate-<version>/gotemplate.wasm
```

**Some Backstage deployments cannot reach GitHub from the browser.** To
self-host, download `gotemplate.wasm` from that release into something you
serve, and point the tool at it:

```yaml
# app-config.yaml
gotemplate:
  wasmUrl: https://static.internal.example.com/gotemplate.wasm
```

Serve it with `Content-Type: application/wasm` to get streaming compilation, and
with compression enabled so the transfer is ~14 MB rather than 83 MB. The loader
falls back to a buffered instantiation when the content type is missing, so a
misconfigured server degrades rather than breaks.

## Building the engine

The `.wasm` is **not committed** — it is built from `wasm/` and requires a Go
toolchain (Go 1.26.5+, matching `wasm/go.mod`):

```bash
yarn build:wasm
```

This writes `static/gotemplate.wasm` — which is neither committed nor part of
the npm package — and refreshes the vendored `src/engine/wasm_exec.js` loader
shim so it always matches the compiler that produced the module. The release
workflow runs it for you and uploads the result to the release.

The Go code is split so the rendering logic is testable on the host platform:

```bash
cd wasm && go test ./...
```

`engine.go` holds the rendering logic and imports no `syscall/js`; `main.go` is
the js/wasm bridge behind a `//go:build js && wasm` tag.

### A note on the external-secrets dependency

ESO's `runtime` module depends on its sibling `apis` module through a relative
`replace` that only applies inside the ESO repo, and `apis` has no tags. Consuming
it from outside therefore requires restating that resolution, which `wasm/go.mod`
does with a `replace` pinned to the same commit as `runtime`. If you bump the ESO
version, both pins have to move together.

## Options

| Control                  | Applies to  | Notes                                                  |
| ------------------------ | ----------- | ------------------------------------------------------ |
| Data format              | all         | YAML or JSON for the data pane                         |
| Left / right delimiter   | all         | e.g. `[[` / `]]` for templates that clash with `{{`    |
| Missing key              | all but ESO | `default`, `zero` or `error`; ESO is pinned to `error` |
| Release name / namespace | Helm        | surfaces as `.Release.Name` / `.Release.Namespace`     |
| Kube version             | Helm        | surfaces as `.Capabilities.KubeVersion`                |

Errors are labelled by phase — **data**, **parse** or **execute** — and a failed
render still shows whatever was emitted before the failure, which is usually the
quickest way to find the offending line.

## Limitations

- Helm's `lookup` needs a live cluster, so it returns empty in the browser, as it
  does during `helm template`.
- ESO's data pane is a flat key/value map; non-string values are JSON-encoded so
  the template still runs, but a real secret only ever holds strings.
- The helm tab renders a synthetic single-file chart, so chart-level features
  that need more files (subcharts, `.Files`, `values.schema.json`) are not
  modelled.

[toolbox]: https://github.com/drodil/backstage-plugin-toolbox
