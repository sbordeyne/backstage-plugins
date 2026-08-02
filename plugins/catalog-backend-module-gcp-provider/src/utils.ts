import { parseEntityRef, stringifyEntityRef } from '@backstage/catalog-model';
import { ANNOTATION_GCP_REGION } from './constants';

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

export function formatResourceName(name: string): string {
  const normalizedName = name.toLocaleLowerCase().replace(/[^a-z0-9-]+/g, '-');
  if (normalizedName.length > 63) {
    return normalizedName.substring(0, 63);
  }
  return normalizedName;
}
