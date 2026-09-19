# @sbordeyne/backstage-plugin-kubespec

The `/kubespec` page: a reference for the Kubernetes API and for the CRDs of the
operators happn runs, served by
[`kubespec-backend`](../kubespec-backend/README.md).

## URLs

Five fixed segments, with two literal aliases so a link parses without any data:

```
/kubespec/kubernetes/latest/apps/v1/Deployment
/kubespec/kubernetes/v1.33/core/v1/Pod          # `core` = the empty API group
/kubespec/cert-manager/v1.21.2/cert-manager.io/v1/Certificate
```

kubespec.dev leaves both the version and the group out when it can and decides at
build time which is which — a parse that needs the data, which a router in a
browser does not have.

`latest` is a moving target on purpose, which is right for a link pasted in Slack
today. The page shows what it currently resolves to and offers a **Pin** button
for links that must not drift.

A property has its own address: `#.spec.template.spec.containers` expands its
ancestors and scrolls to it. The expand/collapse set is deliberately _not_ in the
URL — thousands of paths would make the back button useless.

## The property tree

The whole schema arrives in one request. A resource is 12 KB compressed at the
median and 200 KB at the worst across the entire corpus, so there is no lazy
subtree protocol: expanding, collapsing, filtering and deep-link expansion are all
synchronous.

The tree is a flat list of rows derived from one reducer, not a component that
recurses into itself. That is what makes collapse-all, deep links and a real ARIA
`tree` possible rather than structurally awkward.

Type colours follow a semantic category rather than a literal type name, so a type
nobody has heard of still reads correctly, and colour is never the only signal —
every expandable row also carries a chevron and a child count.

## Notes for the next person

- The tree paints its own panel rather than using the theme surface. The happn
  dark theme's `background.paper` is `#767470`, a mid grey nothing reaches 3:1
  against; `src/lib/propertyTypePalette.ts` documents the measurement and carries
  the validator invocation to re-run if either theme changes.
- Description diffs arrive precomputed from the backend. They are a constant of
  two stored strings, so they are produced once at ingest rather than once per
  reader — which also keeps a diffing library out of the app bundle.
- BUI's `Text` renders a `<span>` by default. Section titles pass `as="h2"` /
  `as="h3"` so the page has a real heading outline.
- `useCursorList` in the bruno plugin predates BUI's `useTable` cursor mode. New
  paginated tables should use the latter.

## Development

```bash
yarn workspace @sbordeyne/backstage-plugin-kubespec start   # dev harness, stubbed backend
yarn workspace @sbordeyne/backstage-plugin-kubespec test
```

The harness stubs the backend, including the cases that are awkward to reproduce
on purpose: a recursive schema, a kind missing from a version, and a failing
request.
