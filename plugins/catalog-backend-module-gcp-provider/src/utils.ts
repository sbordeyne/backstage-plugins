import { createHash } from 'crypto';
import { parseEntityRef, stringifyEntityRef } from '@backstage/catalog-model';
import { LoggerService } from '@backstage/backend-plugin-api';
import {
  ANNOTATION_GCP_REGION,
  ANNOTATION_GCP_SELF_LINK,
  GCP_LABEL_KEY,
  MAX_ANNOTATION_LENGTH,
  MAX_TAGS,
} from './constants';

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

/** A key folded into the shape GCP accepts, or undefined when nothing legal is left of it. */
function toGcpLabelKey(labelKey: string): string | undefined {
  const folded = labelKey
    .toLocaleLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .slice(0, 63);
  return GCP_LABEL_KEY.test(folded) ? folded : undefined;
}

/**
 * The label keys a configured key is looked up under.
 *
 * GCP rejects any key outside {@link GCP_LABEL_KEY}, so a Backstage-style key such as
 * `backstage.io/owner-ref` cannot be set on a resource at all — the API turns it away. The defaults
 * are therefore spelled the way GCP accepts them, and a configured key that is not is folded to its
 * legal form so the label is still found rather than silently never matching.
 *
 * Both spellings are returned, the configured one first: an installation whose labels were written
 * by something other than the GCP API keeps working.
 */
export function ownerLabelKeys(labelKey: string): string[] {
  const gcpLegal = toGcpLabelKey(labelKey);
  return !gcpLegal || gcpLegal === labelKey ? [labelKey] : [labelKey, gcpLegal];
}

/**
 * Checks a configured label key, answering the spelling to look resources up under.
 *
 * A key GCP would reject can never match a label on a real resource, so leaving it unreported means
 * every resource quietly falls back to the default owner or to no system at all — the kind of
 * failure that looks like the module not working rather than like a typo. A key that folds to
 * something legal is reported at error level and the folded form used; one that cannot be folded at
 * all throws, because there is no reading of it that would ever match.
 */
export function readConfiguredLabelKey(labelKey: string, setting: string, logger: LoggerService): string {
  if (GCP_LABEL_KEY.test(labelKey)) {
    return labelKey;
  }
  const gcpLegal = toGcpLabelKey(labelKey);
  if (!gcpLegal) {
    throw new Error(
      `'${labelKey}' is not usable as ${setting}: a GCP label key is 1-63 characters, starts with a ` +
        `lowercase letter and holds only lowercase letters, digits, dashes and underscores`,
    );
  }
  logger.error(
    `${setting}='${labelKey}' is not a label key GCP accepts, so no resource can carry it. Reading ` +
      `'${gcpLegal}' instead — set ${setting} to that to silence this.`,
  );
  return gcpLegal;
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
 * Domains whose *local* part is the project rather than the account name:
 * `my-project@appspot.gserviceaccount.com` is App Engine's account for `my-project`.
 */
const PROJECT_IS_LOCAL_PART = new Set(['appspot.gserviceaccount.com']);

/** Google-managed service agents are `service-<project number>@<agent domain>`. */
const SERVICE_AGENT_LOCAL_PART = /^service-\d+$/;

/** The `.iam.gserviceaccount.com` suffix, under which the domain's first label is a project id. */
const USER_MANAGED_DOMAIN = '.iam.gserviceaccount.com';

/**
 * The project a service account belongs to, or undefined when its email cannot say.
 *
 * Only a *user-managed* account spells its project out: `auth-sa@my-project.iam.gserviceaccount.com`
 * lives in `my-project`. The accounts workloads run as by default do not —
 * `123456-compute@developer.gserviceaccount.com` and
 * `service-123456@gcp-sa-pubsub.iam.gserviceaccount.com` name Google's own domains and identify the
 * project by *number*, which no entity is ever named after. Guessing the first label of those
 * domains yields `developer` or `gcp-sa-pubsub` as a project id and every ref built from it dangles,
 * so they return undefined and the caller falls back to the project it is enumerating.
 */
export function serviceAccountProject(email: string): string | undefined {
  const [localPart, domain] = email.split('@');
  if (!domain) {
    return undefined;
  }
  if (PROJECT_IS_LOCAL_PART.has(domain)) {
    return localPart || undefined;
  }
  if (!domain.endsWith(USER_MANAGED_DOMAIN) || SERVICE_AGENT_LOCAL_PART.test(localPart)) {
    return undefined;
  }
  const project = domain.slice(0, -USER_MANAGED_DOMAIN.length);
  // A service agent whose local part is not the usual `service-<number>` is still recognizable by
  // the `gcp-sa-` domain Google gives them.
  return !project || project.startsWith('gcp-sa-') ? undefined : project;
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
 * The entity name a Pub/Sub subscription is ingested under.
 *
 * Topics and subscriptions are separate namespaces in Pub/Sub, and naming a subscription after the
 * topic it reads is a common convention — an `orders` topic with an `orders` subscription. Both
 * become `Resource` entities in the same catalog namespace, so without a suffix the two carry the
 * same entity ref: one `full` mutation then contains that ref twice, the catalog keeps whichever it
 * saw last, and the surviving subscription depends on itself.
 *
 * Shared with the ref builder, so a relation pointing at a subscription and the subscription's own
 * entity agree on the name.
 */
export function pubsubSubscriptionName(strippedName: string): string {
  return `${strippedName}-sub`;
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

/** Longest name the catalog accepts for an entity or a namespace. */
const MAX_ENTITY_NAME_LENGTH = 63;

/**
 * A short digest of the original name, appended when truncation would otherwise merge two
 * resources.
 *
 * Six base-36 characters of a SHA-1, which is not a security boundary — it only has to be stable
 * across refreshes and different for names that differ, so the entity a resource maps to does not
 * move and two long names do not collapse onto one.
 */
function nameDigest(name: string): string {
  return parseInt(createHash('sha1').update(name).digest('hex').slice(0, 12), 16).toString(36).slice(0, 6);
}

/**
 * A GCP name as an entity name the catalog accepts.
 *
 * Lowercased with anything outside `[a-z0-9-]` folded to `-`. Leading and trailing separators are
 * trimmed because the catalog requires a name to start and end with an alphanumeric — Firestore's
 * `(default)` database would otherwise become `-default-` and have its entity rejected.
 *
 * A name longer than {@link MAX_ENTITY_NAME_LENGTH} keeps a digest of the original, since two
 * resources whose names differ only past the limit are a real thing to have — generated names carry
 * their distinguishing suffix at the end — and plain truncation would give them one entity between
 * them, with each refresh overwriting the other's.
 *
 * Throws when nothing survives normalization — a name of punctuation alone would otherwise yield
 * `resource:namespace/`, which the catalog rejects, taking the provider's whole mutation with it.
 * The caller skips that one resource instead. Use {@link formatResourceNameOrUndefined} where an
 * unusable name is not worth failing over.
 */
export function formatResourceName(name: string): string {
  const formatted = formatResourceNameOrUndefined(name);
  if (!formatted) {
    throw new Error(`'${name}' has no characters an entity name can be built from`);
  }
  return formatted;
}

/**
 * {@link formatResourceName}, answering undefined instead of throwing when nothing survives
 * normalization.
 *
 * For the places where an unusable name is not worth failing over: a relation whose target
 * normalizes to nothing points at an entity that can never exist, so the edge is dropped and the
 * resource holding it is still ingested.
 */
export function formatResourceNameOrUndefined(name: string): string | undefined {
  const normalized = name
    .toLocaleLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+/, '');
  if (normalized.length <= MAX_ENTITY_NAME_LENGTH) {
    return normalized.replace(/-+$/, '') || undefined;
  }
  const suffix = `-${nameDigest(name)}`;
  const head = normalized.slice(0, MAX_ENTITY_NAME_LENGTH - suffix.length).replace(/-+$/, '');
  return `${head}${suffix}`;
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
 * Placeholders, in either supported spelling.
 *
 * `{{name}}` is the one to use. `${name}` is accepted too, but Backstage's own config loader
 * substitutes `${...}` with **environment variables** before any plugin sees the value, and drops
 * the whole key when the variable is unset — so a bare `${projectId}` in `app-config.yaml` never
 * reaches this function at all. Writing it as `$${projectId}` escapes it past the loader and leaves
 * `${projectId}` here, which is why the spelling is still understood.
 */
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}|\$\{\s*([^{}]*?)\s*\}/g;

/**
 * A template with its placeholders replaced by the matching values from `context`.
 *
 * Throws on a placeholder that is not a known variable, so a typo in config surfaces as a warning
 * rather than as entities silently landing in a namespace like `gcp-`.
 */
export function renderTemplate(template: string, context: GcpResourceContext): string {
  return template.replace(PLACEHOLDER, (_match, curly?: string, dollar?: string) => {
    const key = (curly ?? dollar ?? '').trim();
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
