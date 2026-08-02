import { Entity } from '@backstage/catalog-model';
import { RepositoryLocation } from '../types';

const GENERATED_NAME_PREFIX = 'generated-';
const CATALOG_INFO_FILENAME = 'catalog-info.yaml';
const LOCATION_TYPE_PREFIX = 'url:';
/** GitHub puts a resolved file under `/tree/` and a directly-read one under `/blob/`. */
const REPOSITORY_FILE_MARKERS = ['tree', 'blob'];

function safeParseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/** Location annotations are location refs (`url:https://...`), not bare URLs. */
function stripLocationTypePrefix(locationRef: string): string {
  return locationRef.startsWith(LOCATION_TYPE_PREFIX) ? locationRef.slice(LOCATION_TYPE_PREFIX.length) : locationRef;
}

/**
 * Reads the repository out of a `Location` entity emitted by the GitHub catalog provider.
 *
 * Those targets look like `https://github.com/<org>/<repo>/blob/<branch>/<catalogPath>`, where
 * `<catalogPath>` is the configured glob. `org` and `repo` are read from fixed positions so a
 * branch containing a slash cannot shift the parse.
 *
 * Returns undefined for anything that is not a provider-generated repository location, which
 * includes manually registered locations and the locations declared in this repo's own
 * `catalog-info.yaml`.
 */
export function parseGeneratedLocation(entity: Entity): RepositoryLocation | undefined {
  if (entity.kind !== 'Location' || entity.spec?.type !== 'url') {
    return undefined;
  }
  if (!entity.metadata.name.startsWith(GENERATED_NAME_PREFIX)) {
    return undefined;
  }

  const target = entity.spec?.target;
  if (typeof target !== 'string') {
    return undefined;
  }

  const url = safeParseUrl(target);
  if (!url) {
    return undefined;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  const [org, repo, marker] = segments;
  if (!org || !repo || marker !== 'blob') {
    return undefined;
  }

  return { host: url.host, org, repo, target };
}

/**
 * Reads the `catalog-info.yaml` path an entity was actually ingested from.
 *
 * Both URL shapes the provider can produce are accepted, because that depends on whether
 * `catalogPath` is configured as a glob:
 *
 * - glob `catalogPath` — the catalog searches and resolves concrete files under `/tree/`, so
 *   `url:https://github.com/o/r/tree/master/services/api/catalog-info.yaml` yields
 *   `services/api/catalog-info.yaml`.
 * - literal `catalogPath` — the file is read directly and stays under `/blob/`.
 *
 * A still-globbed path is rejected, since it names no single file. A branch containing a slash
 * would leave its remainder in the returned path; the repositories here all use single-segment
 * default branches.
 */
export function parseResolvedCatalogPath(locationRef: string): string | undefined {
  const url = safeParseUrl(stripLocationTypePrefix(locationRef));
  if (!url) {
    return undefined;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 5 || !REPOSITORY_FILE_MARKERS.includes(segments[2])) {
    return undefined;
  }

  const path = segments.slice(4).join('/');
  if (!path || path.includes('*')) {
    return undefined;
  }
  return path;
}

/** Whether a resolved path sits at the repository root, as opposed to inside a monorepo. */
export function isRootCatalogPath(path: string): boolean {
  return path === CATALOG_INFO_FILENAME;
}

/** Turns a `Location` target into the origin location ref its child entities carry. */
export function toOriginLocationRef(target: string): string {
  return `${LOCATION_TYPE_PREFIX}${target}`;
}
