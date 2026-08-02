import { ANNOTATION_GCP_REGION } from './constants';

/**
 * The region annotation, or nothing at all when the region is unknown, so it can be spread into an
 * annotations object without writing an empty or invented value.
 */
export function regionAnnotation(region: string | undefined | null): Record<string, string> {
  return region ? { [ANNOTATION_GCP_REGION]: region } : {};
}

export function formatResourceName(name: string): string {
  const normalizedName = name.toLocaleLowerCase().replace(/[^a-z0-9-]+/g, '-');
  if (normalizedName.length > 63) {
    return normalizedName.substring(0, 63);
  }
  return normalizedName;
}
