import { DEFAULT_LANGUAGES, LanguageOption, UNKNOWN_LANGUAGE } from '../types';

/**
 * The language selection to start from, out of `configuredLanguages`.
 *
 * Pinning the selection keeps the headline coverage figure comparable week to week, but only for
 * the languages that actually occur — otherwise an empty selection is returned, which means "all
 * languages" rather than an empty page. Matching is case-insensitive because the ids come from
 * GitHub verbatim.
 */
export function resolveDefaultLanguages(
  options: readonly LanguageOption[],
  configuredLanguages: readonly string[] = DEFAULT_LANGUAGES,
): string[] {
  const wanted = configuredLanguages.map(language => language.toLowerCase());
  return options.filter(option => wanted.includes(option.id.toLowerCase())).map(option => option.id);
}

/** Human-readable scope, e.g. `Java, Kotlin` or `all languages` when nothing is selected. */
export function describeLanguageSelection(selectedLanguages: readonly string[]): string {
  if (selectedLanguages.length === 0) {
    return 'all languages';
  }
  return selectedLanguages.map(language => (language === UNKNOWN_LANGUAGE ? 'Unknown' : language)).join(', ');
}
