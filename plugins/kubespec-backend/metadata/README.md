# Examples and links

Layout: `<source>/<apiVersion>/<kind lowercased>/`, holding

- `N-<slug>.md` — one example, with `title` and `description` frontmatter and the
  manifest in a fenced YAML block. `N` orders the accordion on the page.
- `<kind>.json` — `{ "links": [{ "name", "href" }] }`, external documentation.

Loaded into the database once at backend startup, so an edit here takes effect on
the next deploy without waiting for a sync.

These files were adapted from [kubespec.dev](https://github.com/aptakube/kubespec.dev),
MIT licensed, Copyright (c) 2024 Aptakube.
