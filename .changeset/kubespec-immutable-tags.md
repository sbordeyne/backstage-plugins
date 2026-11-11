---
'@sbordeyne/backstage-plugin-kubespec-backend': minor
---

Stored versions are no longer listed again on every sync: tags are treated as immutable, so a steady-state tick costs one tag listing per source. A force resync (`POST /v1/sync?force=true`) still re-reads every version.
