import { CoverageFilter, IntegrationStatus } from '../types';

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

export const COVERAGE_FILTER_LABELS: Record<CoverageFilter, string> = {
  all: 'All repositories',
  integrated: 'Integrated',
  'not-integrated': 'Not integrated',
};

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
