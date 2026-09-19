import { createHash } from 'crypto';

export interface HashableEntry {
  path: string;
  /** A git blob sha, or any other identifier that changes with the content. */
  sha: string;
}

/**
 * Fingerprints the inputs of one version without reading any of them.
 *
 * The GitHub contents listing already carries each blob's sha, so a version whose
 * fingerprint is unchanged is skipped before a single file body is downloaded.
 * That is what makes a daily sync of ~280 stored versions nearly free.
 */
export function contentHashOf(entries: readonly HashableEntry[]): string {
  const sorted = [...entries]
    .map(entry => [entry.path, entry.sha])
    .sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));

  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}
