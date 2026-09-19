/**
 * The path segment standing in for the core API group.
 *
 * Duplicated from the frontend rather than imported: this is the one place the
 * two halves agree on a URL, and a search result that 404s because the alias
 * drifted would be worse than a little repetition. The shared test below pins it.
 */
export const CORE_GROUP = 'core';

export interface ResourceLocationOptions {
  sourceSlug: string;
  group: string;
  apiVersion: string;
  kind: string;
}

/**
 * Where a search hit sends a reader.
 *
 * Always `latest`, because only the newest version of a source is indexed, and a
 * pinned version in a search result would go stale the moment a sync ran.
 */
export function resourceLocation(options: ResourceLocationOptions): string {
  return [
    '/kubespec',
    encodeURIComponent(options.sourceSlug),
    'latest',
    encodeURIComponent(options.group === '' ? CORE_GROUP : options.group),
    encodeURIComponent(options.apiVersion),
    encodeURIComponent(options.kind),
  ].join('/');
}
