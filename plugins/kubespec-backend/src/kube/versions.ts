/**
 * Version handling for source tags and API versions.
 *
 * Every function here is total: an unrecognised version sorts somewhere
 * deterministic instead of throwing. kubespec.dev's equivalents throw, and they
 * run inside the ingest loop, so one exotic CRD version takes down a whole
 * project's import.
 */

const PAD_WIDTH = 10;

/** Ordinary string ordering, as a comparator. */
export function compareStrings(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** The identifiers after `-`, or undefined for a release. */
  prerelease?: string;
  /** The input, with any leading `v` intact. */
  raw: string;
}

/** `v1.34`, `1.31.0`, `v1.2.3-rc.1` and `3.5.0-bc1` all parse; anything else is null. */
export function parseVersion(raw: string): ParsedVersion | null {
  const withoutPrefix = raw.startsWith('v') || raw.startsWith('V') ? raw.slice(1) : raw;
  // Build metadata carries no ordering, so it is dropped before matching.
  const withoutBuild = withoutPrefix.split('+')[0];

  const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-(.+))?$/.exec(withoutBuild);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: match[2] === undefined ? 0 : Number(match[2]),
    patch: match[3] === undefined ? 0 : Number(match[3]),
    prerelease: match[4],
    raw,
  };
}

export function isPrerelease(raw: string): boolean {
  return parseVersion(raw)?.prerelease !== undefined;
}

/**
 * A fixed-width, lexicographically sortable key.
 *
 * Stored on the row so that ordering versions in SQL is a plain string sort — no
 * semver in the query, and no dialect-specific collation to reason about.
 */
export function versionSortKey(raw: string): string {
  const parsed = parseVersion(raw);
  if (!parsed) {
    // Unparseable versions sort below every parseable one, and among themselves
    // by their own text, so the order is at least stable.
    return `${'0'.repeat(PAD_WIDTH)}.${'0'.repeat(PAD_WIDTH)}.${'0'.repeat(PAD_WIDTH)}.0.${normalizePrerelease(raw)}`;
  }

  const numbers = [parsed.major, parsed.minor, parsed.patch].map(part => String(part).padStart(PAD_WIDTH, '0'));
  // A release outranks every prerelease of the same number, hence the flag before
  // the prerelease identifiers rather than after them.
  const releaseFlag = parsed.prerelease === undefined ? '1' : '0';
  const prerelease = parsed.prerelease === undefined ? '' : normalizePrerelease(parsed.prerelease);

  return `${numbers.join('.')}.${releaseFlag}.${prerelease}`;
}

/** Pads each numeric run so `rc.2` sorts after `rc.10`'s neighbours correctly. */
function normalizePrerelease(value: string): string {
  return value.toLowerCase().replace(/\d+/g, digits => digits.padStart(PAD_WIDTH, '0'));
}

/** Total ordering over version strings: negative when `a` is older. */
export function compareVersions(a: string, b: string): number {
  return compareStrings(versionSortKey(a), versionSortKey(b));
}

/** Newest first. Does not mutate the input, unlike `semver.rsort`. */
export function sortVersionsDescending(versions: readonly string[]): string[] {
  return [...versions].sort((a, b) => compareVersions(b, a));
}

export interface ParsedApiVersion {
  major: number;
  phase: 'alpha' | 'beta' | 'stable';
  phaseNumber: number;
}

const PHASE_RANK: Record<ParsedApiVersion['phase'], number> = { alpha: 1, beta: 2, stable: 3 };

/**
 * Parses a Kubernetes API version such as `v1`, `v2beta1` or `v1alpha3`.
 *
 * Returns null for anything else — Istio-era forms like `v1p1beta1` exist in the
 * wild, and they must degrade to "sorts last" rather than fail an import.
 */
export function parseApiVersion(version: string): ParsedApiVersion | null {
  const match = /^v(\d+)(?:(alpha|beta)(\d+))?$/.exec(version);
  if (!match) {
    return null;
  }
  return {
    major: Number(match[1]),
    phase: (match[2] as 'alpha' | 'beta' | undefined) ?? 'stable',
    phaseNumber: match[3] === undefined ? Number.POSITIVE_INFINITY : Number(match[3]),
  };
}

/**
 * Orders API versions by maturity: negative when `a` is the less mature.
 *
 * Used to pick which version of a kind to show when several are served, so
 * `v1` beats `v1beta2` beats `v1beta1` beats `v1alpha1`.
 */
export function compareApiVersion(a: string, b: string): number {
  const parsedA = parseApiVersion(a);
  const parsedB = parseApiVersion(b);

  if (!parsedA || !parsedB) {
    if (parsedA) {
      return 1;
    }
    if (parsedB) {
      return -1;
    }
    return compareStrings(a, b);
  }

  if (parsedA.major !== parsedB.major) {
    return parsedA.major > parsedB.major ? 1 : -1;
  }
  if (PHASE_RANK[parsedA.phase] !== PHASE_RANK[parsedB.phase]) {
    return PHASE_RANK[parsedA.phase] > PHASE_RANK[parsedB.phase] ? 1 : -1;
  }
  if (parsedA.phaseNumber !== parsedB.phaseNumber) {
    return parsedA.phaseNumber > parsedB.phaseNumber ? 1 : -1;
  }
  return 0;
}

/**
 * The major number an API version belongs to, for grouping the versions of one
 * kind.
 *
 * Parses the digits rather than slicing the first two characters as kubespec.dev
 * does, where `v10alpha1` and `v1` both reduce to `v1` and silently collapse into
 * each other.
 */
export function apiVersionMajor(version: string): string {
  const match = /^v(\d+)/.exec(version);
  return match ? match[1] : version;
}
