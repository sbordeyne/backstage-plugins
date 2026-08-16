import { IntegrationStatus, ProviderSkip, RepositoryKind, StatusFilter } from '../types';

/** Rendering order of the provider skips, from the most common to the rarest. */
export const ALL_PROVIDER_SKIPS: ProviderSkip[] = ['archived', 'fork', 'no-default-branch'];

/** Rendering order of the repository kinds, the one the provider walks first. */
export const ALL_REPOSITORY_KINDS: RepositoryKind[] = ['active', ...ALL_PROVIDER_SKIPS];

export const REPOSITORY_KIND_LABELS: Record<RepositoryKind, string> = {
  active: 'Active',
  archived: 'Archived',
  fork: 'Fork',
  'no-default-branch': 'Empty',
};

export const REPOSITORY_KIND_DESCRIPTIONS: Record<RepositoryKind, string> = {
  active: 'Walked by the catalog provider, so it can be onboarded.',
  archived: 'Archived on GitHub. The provider skips it, and GitHub refuses pull requests against it.',
  fork: 'A fork. The provider skips it, so a catalog-info.yaml merged into it would still not be read.',
  'no-default-branch': 'No default branch — an empty repository. There is nothing for the provider to read.',
};

/** Shown for an active repository the provider has not walked yet. */
export const AWAITING_SYNC_LABEL = 'Awaiting sync';

export const STATUS_LABELS: Record<IntegrationStatus, string> = {
  integrated: 'Integrated',
  'integrated-nested': 'Integrated (nested)',
  drift: 'Drift',
  'not-integrated': 'Not integrated',
  unknown: 'Unknown',
};

export const STATUS_DESCRIPTIONS: Record<IntegrationStatus, string> = {
  integrated: 'A catalog-info.yaml at the repository root produced catalog entities.',
  'integrated-nested': 'Entities were produced, but only from nested paths — typically a monorepo.',
  drift:
    'A catalog-info.yaml exists at the root but produced no entities: invalid file, or the hourly sync has not caught up.',
  'not-integrated': 'No catalog-info.yaml and no catalog entities.',
  unknown: 'GitHub could not be reached, so a missing file cannot be told apart from an invalid one.',
};

/**
 * The single status filter, coarse groupings first.
 *
 * The two specific "integrated" entries are qualified, so that `Integrated — any` and
 * `Integrated (root file)` cannot be mistaken for each other in the list.
 */
export const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'All repositories',
  covered: 'Integrated — any',
  uncovered: 'Not integrated — any',
  integrated: 'Integrated (root file)',
  'integrated-nested': 'Integrated (nested)',
  drift: 'Drift',
  'not-integrated': 'Not integrated (no file)',
  unknown: 'Unknown',
};

/** Rendering order of the status filter: the groupings, then each individual status. */
export const ALL_STATUS_FILTERS: StatusFilter[] = [
  'all',
  'covered',
  'uncovered',
  'integrated',
  'integrated-nested',
  'drift',
  'not-integrated',
  'unknown',
];

/**
 * ISO-8601 day, chosen over a locale-formatted date so the value stays sortable, unambiguous
 * across locales, and stable in tests.
 */
export function formatDate(isoTimestamp: string | undefined): string {
  if (!isoTimestamp) {
    return '—';
  }
  const parsed = new Date(isoTimestamp);
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toISOString().slice(0, 10);
}
