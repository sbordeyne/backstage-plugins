import { JsonObject, JsonValue } from '@backstage/types';
import { RepositoryRow } from '../types';

/**
 * `{{ field }}`, optionally `{{ field | fallback }}`.
 *
 * Mustache-style braces rather than Backstage's own `${...}`, which the config loader would try to
 * substitute out of `app-config.yaml` before the plugin ever sees it.
 */
const PLACEHOLDER = /\{\{\s*(\w+)\s*(?:\|([^}]*))?\}\}/g;

/** The repository fields a configured default may interpolate. */
function placeholderValues(row: RepositoryRow): Record<string, string | undefined> {
  return {
    repo: row.repo,
    org: row.org,
    url: row.url,
    defaultBranch: row.defaultBranch,
    primaryLanguage: row.primaryLanguage,
    status: row.status,
  };
}

/** Expands every placeholder in one string, resolving each to its fallback, then to the empty string. */
function expand(value: string, values: Record<string, string | undefined>): string {
  return value.replace(PLACEHOLDER, (_match, field: string, fallback?: string) => {
    return values[field] ?? fallback?.trim() ?? '';
  });
}

/** Walks the configured defaults, expanding the strings and leaving every other leaf as it is. */
function expandValue(value: JsonValue, values: Record<string, string | undefined>): JsonValue {
  if (typeof value === 'string') {
    return expand(value, values);
  }
  if (Array.isArray(value)) {
    return value.map(item => expandValue(item as JsonValue, values));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, expandValue(item as JsonValue, values)]),
    );
  }
  return value;
}

/**
 * The prefill handed to the scaffolder wizard, built by expanding the configured defaults against
 * one repository.
 *
 * Placeholders that name no known field expand to their fallback, and to the empty string when they
 * carry none: an installation naming a field that does not exist gets an empty form control rather
 * than a literal `{{ typo }}` in it.
 */
export function buildTemplatePrefill(defaults: JsonObject, row: RepositoryRow): JsonObject {
  return expandValue(defaults, placeholderValues(row)) as JsonObject;
}
