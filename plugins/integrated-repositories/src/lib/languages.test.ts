import { describeLanguageSelection, resolveDefaultLanguages } from './languages';
import { LanguageOption, UNKNOWN_LANGUAGE } from '../types';

function option(id: string, repositoryCount: number = 1): LanguageOption {
  return { id, label: id === UNKNOWN_LANGUAGE ? 'Unknown' : id, repositoryCount };
}

describe('resolveDefaultLanguages', () => {
  it('selects the configured languages that are present', () => {
    const options = [option('Java', 55), option('Go'), option('Kotlin', 2)];

    expect(resolveDefaultLanguages(options, ['Java', 'Kotlin'])).toEqual(['Java', 'Kotlin']);
  });

  it('selects whichever of the configured languages is present', () => {
    expect(resolveDefaultLanguages([option('Java'), option('Python')], ['Java', 'Kotlin'])).toEqual(['Java']);
  });

  it('matches case-insensitively but returns the ids as GitHub reported them', () => {
    expect(resolveDefaultLanguages([option('java'), option('KOTLIN')], ['Java', 'Kotlin'])).toEqual(['java', 'KOTLIN']);
  });

  it('falls back to an empty selection, meaning all languages, when none is present', () => {
    expect(resolveDefaultLanguages([option('Go'), option('Python')], ['Java', 'Kotlin'])).toEqual([]);
  });

  it('falls back to an empty selection when there are no options at all', () => {
    expect(resolveDefaultLanguages([], ['Java'])).toEqual([]);
  });

  it('selects nothing when no language is configured, which is the default scope', () => {
    expect(resolveDefaultLanguages([option('Java'), option('Kotlin')], [])).toEqual([]);
  });
});

describe('describeLanguageSelection', () => {
  it('describes an empty selection as all languages', () => {
    expect(describeLanguageSelection([])).toBe('all languages');
  });

  it('joins the selected languages', () => {
    expect(describeLanguageSelection(['Java', 'Kotlin'])).toBe('Java, Kotlin');
  });

  it('renders the unknown sentinel readably', () => {
    expect(describeLanguageSelection(['Java', UNKNOWN_LANGUAGE])).toBe('Java, Unknown');
  });
});
