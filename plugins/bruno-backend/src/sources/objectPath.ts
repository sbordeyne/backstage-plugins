/**
 * Whether an object path is one the sync should consider.
 *
 * Object stores hold more than Bruno reports under one prefix, and a run directory usually splits
 * its reports by suite. `requiredPathSegment` keeps only the objects directly under a segment of
 * that name — `.../run-42/unit/users.json` with `unit`. An empty value accepts every object under
 * the prefix.
 */
export function matchesRequiredSegment(objectName: string, requiredPathSegment: string): boolean {
  if (!requiredPathSegment) {
    return true;
  }
  const segments = objectName.split('/');
  return segments[segments.length - 2] === requiredPathSegment;
}
