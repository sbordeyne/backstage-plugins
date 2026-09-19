# @sbordeyne/kubespec-common

Wire types shared by `@sbordeyne/backstage-plugin-kubespec-backend` (which produces them)
and `@sbordeyne/backstage-plugin-kubespec` (which renders them).

Nothing here depends on Backstage, knex or React — it is types only, so a change
to the contract breaks both halves at compile time rather than at runtime.

There is nothing to install on its own: both plugins depend on it. Their
documentation lives at
[sbordeyne.github.io/backstage-plugins/plugins/kubespec](https://sbordeyne.github.io/backstage-plugins/plugins/kubespec/).
