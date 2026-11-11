---
'@sbordeyne/backstage-plugin-toolbox-module-gotemplate': minor
---

The engine is now downloaded with Backstage's `fetchApi`, so a `gotemplate.wasmUrl` served by the backend receives the user's token and can require sign-in. `loadEngine` takes an optional `fetchFn`.
