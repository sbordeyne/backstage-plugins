import { LanguageOption, UNKNOWN_LANGUAGE } from '../types';

/**
 * The language selection to start from.
 *
 * A configured default only applies to the languages that actually occur, so a selection that would
 * match nothing collapses to the empty one, which means "all languages" rather than an empty page.
 * Matching is case-insensitive because the ids come from GitHub verbatim.
 */
export function resolveDefaultLanguages(
  options: readonly LanguageOption[],
  defaultLanguages: readonly string[],
): string[] {
  const wanted = defaultLanguages.map(language => language.toLowerCase());
  return options.filter(option => wanted.includes(option.id.toLowerCase())).map(option => option.id);
}

/** Human-readable scope, e.g. `Java, Kotlin` or `all languages` when nothing is selected. */
export function describeLanguageSelection(selectedLanguages: readonly string[]): string {
  if (selectedLanguages.length === 0) {
    return 'all languages';
  }
  return selectedLanguages.map(language => (language === UNKNOWN_LANGUAGE ? 'Unknown' : language)).join(', ');
}
