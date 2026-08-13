import { parseEntityRef, stringifyEntityRef } from '@backstage/catalog-model';
import { ANNOTATION_GCP_REGION, ANNOTATION_GCP_SELF_LINK, MAX_ANNOTATION_LENGTH, MAX_TAGS } from './constants';

/**
 * Labels as the GCP APIs hand them over: every client types the map slightly differently, and the
 * protobuf-backed ones use `null` where the REST ones use `undefined`.
 */
export type GcpLabels = Record<string, string | null | undefined> | null | undefined;

/**
 * The region annotation, or nothing at all when the region is unknown, so it can be spread into an
 * annotations object without writing an empty or invented value.
 */
export function regionAnnotation(region: string | undefined | null): Record<string, string> {
  return region ? { [ANNOTATION_GCP_REGION]: region } : {};
}

/**
 * The self link annotation, or nothing at all when the API reported no URL for the resource, on the
 * same grounds as {@link regionAnnotation}.
 */
export function selfLinkAnnotation(selfLink: string | undefined | null): Record<string, string> {
  return selfLink ? { [ANNOTATION_GCP_SELF_LINK]: selfLink } : {};
}

/**
 * The label keys a configured key is looked up under.
 *
 * GCP rejects label keys outside `[a-z]([-a-z0-9_]{0,62})?`, so a Backstage-style key such as
 * `backstage.io/owner-ref` cannot be set on a resource at all. Its dots and slashes are folded to
 * underscores and that form — `backstage_io_owner-ref` — is accepted as meaning the same label, so
 * the default key works on real resources without every installation having to reconfigure it.
 */
export function ownerLabelKeys(labelKey: string): string[] {
  const gcpLegal = labelKey.toLocaleLowerCase().replace(/[^a-z0-9_-]+/g, '_');
  return gcpLegal === labelKey ? [labelKey] : [labelKey, gcpLegal];
}

/** The value of the first label key that carries one, ignoring empty values. */
export function readLabel(labels: GcpLabels, labelKey: string): string | undefined {
  if (!labels) {
    return undefined;
  }
  for (const key of ownerLabelKeys(labelKey)) {
    const value = labels[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return undefined;
}

/**
 * The entity ref an owner label points at.
 *
 * GCP restricts label values to `[a-z0-9_-]`, so a ref cannot be spelled out in full there: the
 * usual value is a bare name like `platform-team`, read as a group in the default namespace. A
 * value that does name a kind or namespace is parsed as the ref it already is, for the case where
 * the label was written by something other than the GCP API.
 *
 * Throws when the value is not a usable ref, leaving the caller to decide what to do about it.
 */
export function parseOwnerRef(value: string): string {
  return stringifyEntityRef(parseEntityRef(value, { defaultKind: 'Group', defaultNamespace: 'default' }));
}

/**
 * The entity ref a system label points at, read the same way as {@link parseOwnerRef} but defaulting
 * to a System: a bare value like `payments` becomes `system:default/payments`.
 */
export function parseSystemRef(value: string): string {
  return stringifyEntityRef(parseEntityRef(value, { defaultKind: 'System', defaultNamespace: 'default' }));
}

/**
 * Last segment of a slash-separated GCP resource name or URL.
 *
 * The REST APIs name resources by their full path — `projects/p/locations/l/clusters/c` — and both
 * the entity name and the console URL want only the leaf.
 */
export function lastSegment(name: string | null | undefined): string {
  return (name ?? '').split('/').filter(Boolean).pop() ?? '';
}

/**
 * The value of a `.../<key>/<value>/...` pair in a GCP resource name, e.g. the location of
 * `projects/p/locations/europe-west1/clusters/c`.
 */
export function segmentAfter(name: string | null | undefined, key: string): string | undefined {
  const parts = (name ?? '').split('/');
  const index = parts.indexOf(key);
  return index >= 0 && index + 1 < parts.length ? parts[index + 1] : undefined;
}

/**
 * An annotation value cut to {@link MAX_ANNOTATION_LENGTH}, with a marker saying so.
 *
 * The IAM annotations summarize lists with no natural bound, and a truncated value that admits it
 * is more useful than either an unbounded one or a silently clipped one.
 */
export function truncateAnnotation(value: string, limit: number = MAX_ANNOTATION_LENGTH): string {
  if (value.length <= limit) {
    return value;
  }
  const marker = '…(truncated)';
  return `${value.slice(0, limit - marker.length)}${marker}`;
}

/**
 * True for the failures that mean "this project has nothing to offer", as opposed to a call that
 * should be retried.
 *
 * A project whose API is not enabled, or that the credentials cannot read, answers 403; a project
 * that does not exist answers 404. Both are permanent until someone changes configuration in GCP,
 * so the right response is to log and carry on. Anything else — a timeout, a 500, a quota error —
 * has to propagate, because a provider applies a `full` mutation and a short result would delete
 * every entity the failed call should have returned.
 */
export function isPermanentlyEmpty(error: unknown): boolean {
  const status = (error as { response?: { status?: number } })?.response?.status;
  const code = (error as { code?: number | string })?.code;
  const numeric = status ?? (typeof code === 'number' ? code : Number(code));
  return numeric === 403 || numeric === 404;
}

/**
 * A name with every configured prefix taken off, applied repeatedly until none matches.
 *
 * `myorg-prod-orders` with `['myorg-', 'prod-']` becomes `orders`. Shared between the Pub/Sub
 * provider, which strips prefixes off the names it ingests, and the refs other providers build to
 * point at those entities — the two have to agree or the relation dangles.
 */
export function stripPrefixes(name: string, prefixes: string[]): string {
  let stripped = name;
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of prefixes) {
      if (prefix && stripped.startsWith(prefix)) {
        stripped = stripped.slice(prefix.length);
        changed = true;
      }
    }
  }
  return stripped;
}

/**
 * The region a location belongs to: `europe-west1-b` is in `europe-west1`, and a region is its own.
 *
 * Zonal resources regularly reference regional ones — a zonal GKE cluster sits in a regional subnet
 * — so the two forms have to be reconciled before a ref can be built.
 */
export function regionOf(location: string | null | undefined): string | undefined {
  if (!location) {
    return undefined;
  }
  // A zone is its region plus a single-letter suffix.
  return /-[a-z]$/.test(location) ? location.slice(0, -2) : location;
}

/**
 * The project, location and name a Compute-style resource URL points at.
 *
 * The Compute API refers to other resources by full URL —
 * `https://www.googleapis.com/compute/v1/projects/p/regions/europe-west1/subnetworks/apps` — and a
 * relation to one needs its project (which may differ from the project being enumerated, in a
 * shared VPC) as much as its name.
 */
export function parseResourceUrl(url: string | null | undefined): {
  projectId?: string;
  region?: string;
  zone?: string;
  name: string;
} {
  return {
    projectId: segmentAfter(url, 'projects'),
    region: segmentAfter(url, 'regions'),
    zone: segmentAfter(url, 'zones'),
    name: lastSegment(url),
  };
}

/**
 * The canonical REST URL of a resource, for the APIs that report no `selfLink` of their own.
 *
 * It is the URL the API itself would be called on, which is what a self link is; building it here
 * keeps the annotation present for every resource type rather than only the Compute-style ones.
 */
export function apiSelfLink(host: string, version: string, resourceName: string | null | undefined): string {
  return `https://${host}/${version}/${(resourceName ?? '').replace(/^\//, '')}`;
}

/**
 * A GCP name as an entity name the catalog accepts.
 *
 * Lowercased with anything outside `[a-z0-9-]` folded to `-`, then truncated to 63 characters.
 * Leading and trailing separators are trimmed because the catalog requires a name to start and end
 * with an alphanumeric — Firestore's `(default)` database would otherwise become `-default-` and
 * have its entity rejected.
 */
export function formatResourceName(name: string): string {
  return name
    .toLocaleLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 63)
    .replace(/-+$/, '');
}

/**
 * What a namespace template is rendered against: the facts about a resource that are known before
 * its entity exists, so a template can sort entities by project, kind of resource or region.
 */
export interface GcpResourceContext {
  /** Project the resource lives in. */
  projectId: string;
  /** Value used as `spec.type`, e.g. `bucket` or `pubsub-topic`. */
  type: string;
  /** Name of the provider that ingested the resource, e.g. `gcp-bucket`. */
  provider: string;
  /** Region or location, when the API reported one. */
  region?: string;
  /** Entity name of the resource itself. */
  name?: string;
}

/** Placeholders a namespace template may use, listed in errors so a typo says what was available. */
const TEMPLATE_VARIABLES = ['projectId', 'type', 'provider', 'region', 'name'] as const;

/**
 * A template with `${placeholder}` replaced by the matching value from `context`.
 *
 * Throws on a placeholder that is not a known variable, so a typo in config surfaces as a warning
 * rather than as entities silently landing in a namespace like `gcp-`.
 */
export function renderTemplate(template: string, context: GcpResourceContext): string {
  return template.replace(/\$\{\s*([^}]*)\s*\}/g, (_match, rawKey: string) => {
    const key = rawKey.trim();
    if (!(TEMPLATE_VARIABLES as readonly string[]).includes(key)) {
      throw new Error(`Unknown template variable '${key}', expected one of ${TEMPLATE_VARIABLES.join(', ')}`);
    }
    return context[key as keyof GcpResourceContext] ?? '';
  });
}

/**
 * Both halves of a label key, and a label value, are limited to this shape by the catalog. GCP's
 * own restrictions are stricter, so real labels pass; the check is here for the ones written by
 * something other than the GCP console.
 */
const LABEL_PART = /^[a-zA-Z0-9]([-a-zA-Z0-9_.]{0,61}[a-zA-Z0-9])?$/;

function isValidLabelKey(key: string): boolean {
  const parts = key.split('/');
  return parts.length <= 2 && parts.every(part => LABEL_PART.test(part));
}

/**
 * GCP labels as catalog labels.
 *
 * Every label a resource carries is copied over, so the catalog can be filtered on the same
 * vocabulary teams already tag their infrastructure with. Labels the catalog would reject — an
 * empty value, or a key or value outside {@link LABEL_PART} — are dropped rather than mangled into
 * something that no longer matches what is on the resource; emitting them would have the catalog
 * reject the whole entity.
 */
/**
 * Catalog tags built from arbitrary GCP strings.
 *
 * Tags are a search vocabulary rather than data, so anything that cannot be a tag is folded rather
 * than dropped: lowercased, everything outside `[a-z0-9+#]` turned into a separator, and the result
 * trimmed, truncated and deduplicated. Empty results disappear, and the list is capped at
 * {@link MAX_TAGS} so a resource with fifty labels does not bury the entity page.
 */
export function toEntityTags(values: (string | null | undefined)[]): string[] {
  const tags: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const tag = value
      .toLocaleLowerCase()
      .replace(/[^a-z0-9+#]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 63)
      .replace(/-+$/g, '');
    if (tag && !tags.includes(tag)) {
      tags.push(tag);
    }
  }
  return tags.slice(0, MAX_TAGS);
}

export function toEntityLabels(labels: GcpLabels): Record<string, string> {
  if (!labels) {
    return {};
  }
  const entityLabels: Record<string, string> = {};
  for (const [key, value] of Object.entries(labels)) {
    if (typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed === '' || !isValidLabelKey(key) || !LABEL_PART.test(trimmed)) {
      continue;
    }
    entityLabels[key] = trimmed;
  }
  return entityLabels;
}
