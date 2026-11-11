# @sbordeyne/backstage-plugin-toolbox-module-gotemplate

## 0.3.0

### Minor Changes

- b596147: The engine is now downloaded with Backstage's `fetchApi`, so a `gotemplate.wasmUrl` served by the backend receives the user's token and can require sign-in. `loadEngine` takes an optional `fetchFn`.
