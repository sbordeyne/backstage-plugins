# Go template playground

`@sbordeyne/backstage-plugin-toolbox-module-gotemplate`

Adds a Go template playground to [drodil's Toolbox plugin](https://github.com/drodil/backstage-plugin-toolbox),
with a switch between the **sprig**, **sprout**, **helm** and **external-secrets-operator**
function sets.

Templates are evaluated by Go's real `text/template`, compiled to WebAssembly, wired to the
genuine upstream libraries. Nothing here is a JavaScript reimplementation, so the output — and,
just as importantly, the error text — matches what the corresponding tool produces.

## Why four sets rather than one

The sets are not interchangeable, and most of the value of the tool is in showing where they
diverge.

| Set                  | Backed by                                                    | Distinctive behaviour                                                                       |
| -------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| **Sprig**            | `github.com/Masterminds/sprig/v3`                             | The baseline most tools mean by "sprig functions"                                             |
| **Sprout**           | `github.com/go-sprout/sprout`                                 | Renamed nearly everything: `toUpper`, `base64Encode`, `toKebabCase`. Adds a network registry |
| **Helm**             | `helm.sh/helm/v3/pkg/engine`                                  | Drops `env`/`expandenv`; adds `include`, `tpl`, `required`, `toYaml`, `.Release`, `.Chart`    |
| **External Secrets** | `external-secrets/runtime/template/v2`                        | Flat `map[string]string` context, forced `missingkey=error`, PKCS12/JWK/PEM helpers           |

!!! warning "Sprout is not a drop-in replacement for sprig"

    Sprout renamed most of sprig's functions. A template using `upper`, `b64enc` or `kebabcase`
    fails on the sprout tab with `function "upper" not defined` — which is exactly what would
    happen in production. Use the function reference above the editors to find the new name.

Each tab loads its own sample, written to exercise that set's specifics rather than repeating the
same output four times.

## Installation

```bash
yarn --cwd packages/app add @sbordeyne/backstage-plugin-toolbox-module-gotemplate
```

Register the module next to the toolbox plugin where you call `createApp`:

```ts
import toolboxPlugin from '@drodil/backstage-plugin-toolbox';
import gotemplateModule from '@sbordeyne/backstage-plugin-toolbox-module-gotemplate';

export const app = createApp({
  features: [toolboxPlugin, gotemplateModule],
});
```

The tool appears under **Miscellaneous → Go template playground**, and answers to the aliases
`gotemplate`, `sprig`, `sprout`, `helm` and `eso`.

!!! note "Toolbox v2 and the new frontend system"

    This module registers through `ToolboxToolBlueprint`, which exists only in toolbox **v2**.
    That release requires Backstage's new frontend system.

## Serving the engine

The engine is one WebAssembly module of roughly **83 MB raw, 14 MB gzipped**. That size is the
direct cost of running the real helm and external-secrets code, both of which pull in `client-go`
and `apimachinery`. It is downloaded lazily the first time somebody opens the tool, then cached by
the browser.

Left alone, the tool fetches it from jsDelivr:

```
https://cdn.jsdelivr.net/npm/@sbordeyne/backstage-plugin-toolbox-module-gotemplate@<version>/static/gotemplate.wasm
```

!!! warning "Most corporate deployments should self-host this"

    If your Backstage instance blocks public CDNs, the tool renders a load failure naming the URL
    it tried. Copy `static/gotemplate.wasm` out of the installed package to somewhere you serve,
    and point the tool at it:

    ```yaml
    # app-config.yaml
    gotemplate:
      wasmUrl: https://static.internal.example.com/gotemplate.wasm
    ```

Serve the file with `Content-Type: application/wasm` so the browser can compile it while it
downloads, and with compression on so the transfer is ~14 MB rather than 83 MB. When the content
type is absent the loader buffers the whole body and instantiates from the bytes instead, so a
misconfigured server is slower rather than broken.

## Options

| Control                  | Applies to   | Effect                                                       |
| ------------------------ | ------------ | ------------------------------------------------------------ |
| Data format              | all          | Reads the data pane as YAML or JSON                           |
| Left / right delimiter   | all          | For templates that clash with `{{`, e.g. `[[` and `]]`        |
| Missing key              | all but ESO  | `default`, `zero` or `error`                                  |
| Release name, namespace  | helm         | Populates `.Release.Name` and `.Release.Namespace`            |
| Kube version             | helm         | Populates `.Capabilities.KubeVersion`                         |

The missing-key control is disabled on the external-secrets tab: the operator hardcodes
`missingkey=error`, and letting it be relaxed here would make a template that fails in-cluster
look healthy.

## Reading a failure

Errors are tagged with the phase that produced them:

- **data** — the data pane is not valid YAML/JSON, or is the wrong shape for the set (helm needs a
  mapping for `.Values`; external-secrets needs a flat key/value map).
- **parse** — the template itself does not compile, e.g. an unclosed action.
- **execute** — the template compiled but blew up while rendering, e.g. `required` tripping.

An execute failure still shows whatever was written before it, which is usually the fastest way to
locate the offending line.

## Limitations

- Helm's `lookup` needs a live cluster, so it returns empty — the same as `helm template`.
- The helm tab wraps your template in a synthetic single-file chart, so subcharts, `.Files` and
  `values.schema.json` are not modelled.
- The external-secrets context is a flat string map. Non-string values in the data pane are
  JSON-encoded so the template still runs, but a real secret only ever holds strings.

## Building from source

The `.wasm` is not committed. Building it needs a Go toolchain matching `wasm/go.mod`:

```bash
cd plugins/toolbox-module-gotemplate
yarn build:wasm     # writes static/gotemplate.wasm
cd wasm && go test ./...
```

The Go sources are split so the rendering logic stays testable on the host platform: `engine.go`
imports no `syscall/js`, while `main.go` carries the browser bridge behind a `//go:build js && wasm`
tag. `yarn prepack` runs the wasm build automatically before publishing.

!!! note "The external-secrets dependency needs a pinned `replace`"

    ESO's `runtime` module reaches its sibling `apis` module through a relative `replace` that only
    applies inside the ESO repository, and `apis` carries no tags. Consuming `runtime` from outside
    means restating that resolution, which `wasm/go.mod` does with a `replace` pinned to the same
    commit as `runtime`. Bumping the ESO version means moving both pins together.
