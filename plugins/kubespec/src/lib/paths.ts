/**
 * The path segment standing in for the core Kubernetes API group, whose real
 * name is the empty string.
 *
 * A group is a DNS subdomain and so always contains a dot in practice, which is
 * why a bare word is safe here; the backend additionally refuses a source slug of
 * `core` so the two can never be confused.
 */
export const CORE_GROUP_SEGMENT = 'core';

/** Stands for "whatever the newest ingested version is", resolved by the backend. */
export const LATEST_VERSION = 'latest';

/** Identifies one kind in one version of one source, as the URL carries it. */
export interface ResourceRef {
  sourceId: string;
  /** May be the literal `latest`. */
  sourceVersion: string;
  /** The real group name: empty string for core. */
  group: string;
  apiVersion: string;
  kind: string;
}

export function encodeGroupSegment(group: string): string {
  return group === '' ? CORE_GROUP_SEGMENT : group;
}

export function decodeGroupSegment(segment: string): string {
  return segment === CORE_GROUP_SEGMENT ? '' : segment;
}

/** Path relative to the plugin's mount point. */
export function sourcePath(sourceId: string, sourceVersion: string): string {
  return `${encodeURIComponent(sourceId)}/${encodeURIComponent(sourceVersion)}`;
}

export function resourcePath(ref: ResourceRef): string {
  return [
    encodeURIComponent(ref.sourceId),
    encodeURIComponent(ref.sourceVersion),
    encodeURIComponent(encodeGroupSegment(ref.group)),
    encodeURIComponent(ref.apiVersion),
    encodeURIComponent(ref.kind),
  ].join('/');
}

/** `apps/v1`, or just `v1` for the core group. */
export function apiVersionFull(group: string, apiVersion: string): string {
  return group ? `${group}/${apiVersion}` : apiVersion;
}

/** `.a.b.c` -> `.a.b`, and `.a` -> `` (the root). */
export function parentPath(path: string): string {
  const index = path.lastIndexOf('.');
  return index <= 0 ? '' : path.slice(0, index);
}

/** `.a.b.c` -> `c`. */
export function propertyName(path: string): string {
  return path.slice(path.lastIndexOf('.') + 1);
}

/**
 * Every path from the root down to `path`, inclusive.
 *
 * A deep link only has to expand these, and they are derived by splitting the
 * string — no request, and no walking the tree to find out where a property sits.
 */
export function ancestorPaths(path: string): string[] {
  const names = path.split('.').filter(Boolean);
  const paths: string[] = [''];

  let current = '';
  for (const name of names) {
    current = `${current}.${name}`;
    paths.push(current);
  }

  return paths;
}
