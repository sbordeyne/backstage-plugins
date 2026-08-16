import { KindOption, LanguageOption, Perimeter, RepositoryKind, RepositoryRow, UNKNOWN_LANGUAGE } from '../types';
import { describeLanguageSelection } from './languages';
import { ALL_REPOSITORY_KINDS, REPOSITORY_KIND_LABELS } from './labels';

/**
 * Active repositories in every language.
 *
 * The page opens on the population that can actually be acted on: an archived repository or a fork
 * can never be onboarded, so counting them would put permanently unreachable coverage in the
 * headline figure. The other kinds are one click away, and the figure always names the kinds it
 * measured, so a narrowed perimeter can never be mistaken for the whole organization.
 */
export const DEFAULT_PERIMETER: Perimeter = { languages: [], kinds: ['active'] };

/**
 * What a repository is, from the provider's point of view.
 *
 * A repository with no skip reason is `active`; one with several is all of them at once, so an
 * archived fork answers to both controls.
 */
export function repositoryKinds(row: RepositoryRow): RepositoryKind[] {
  return row.providerSkips.length > 0 ? row.providerSkips : ['active'];
}

/**
 * Whether a repository falls inside the selected languages.
 *
 * An empty selection means "no language filter", so it matches everything rather than nothing —
 * clearing the control must never blank the page. A repository with no detected language matches
 * only the explicit {@link UNKNOWN_LANGUAGE} option.
 */
export function isLanguageSelected(row: RepositoryRow, selectedLanguages: readonly string[]): boolean {
  if (selectedLanguages.length === 0) {
    return true;
  }
  if (row.primaryLanguage === undefined) {
    return selectedLanguages.includes(UNKNOWN_LANGUAGE);
  }
  const language = row.primaryLanguage.toLowerCase();
  return selectedLanguages.some(selected => selected.toLowerCase() === language);
}

/**
 * Whether a repository is one of the selected kinds.
 *
 * An empty selection means every kind, for the same reason an empty language selection does: clearing
 * a control must never blank the page. A repository that is several kinds at once matches if *any* of
 * them is selected, so an archived fork shows up under either.
 */
export function isKindSelected(row: RepositoryRow, selectedKinds: readonly RepositoryKind[]): boolean {
  if (selectedKinds.length === 0) {
    return true;
  }
  return repositoryKinds(row).some(kind => selectedKinds.includes(kind));
}

/** Whether a repository is inside the perimeter, and therefore counts towards the coverage figure. */
export function isInPerimeter(row: RepositoryRow, perimeter: Perimeter): boolean {
  return isLanguageSelected(row, perimeter.languages) && isKindSelected(row, perimeter.kinds);
}

/**
 * The selectable languages, derived from the repositories themselves so the list always matches the
 * organization. Ordered by repository count so the dominant languages come first.
 *
 * Counted over the repositories the other perimeter controls currently admit, so the figure on a
 * language is what selecting it would actually leave.
 */
export function collectLanguageOptions(rows: RepositoryRow[], perimeter: Perimeter): LanguageOption[] {
  const counts = new Map<string, number>();
  let withoutLanguage = 0;

  for (const row of rows.filter(candidate => isKindSelected(candidate, perimeter.kinds))) {
    if (row.primaryLanguage === undefined) {
      withoutLanguage += 1;
    } else {
      counts.set(row.primaryLanguage, (counts.get(row.primaryLanguage) ?? 0) + 1);
    }
  }

  const options = [...counts.entries()]
    .map(([label, repositoryCount]) => ({ id: label, label, repositoryCount }))
    .sort((a, b) => b.repositoryCount - a.repositoryCount || a.label.localeCompare(b.label));

  if (withoutLanguage > 0) {
    options.push({ id: UNKNOWN_LANGUAGE, label: 'Unknown', repositoryCount: withoutLanguage });
  }
  return options;
}

/**
 * The selectable repository kinds, each carrying how many repositories it holds in the current
 * language selection — so the number beside a kind is what selecting it alone would leave.
 *
 * Only kinds that actually occur are offered, so an organization with no forks is not shown an option
 * that can only ever select nothing.
 */
export function collectKindOptions(rows: RepositoryRow[], perimeter: Perimeter): KindOption[] {
  const scoped = rows.filter(row => isLanguageSelected(row, perimeter.languages));

  return ALL_REPOSITORY_KINDS.filter(kind => rows.some(row => repositoryKinds(row).includes(kind))).map(kind => ({
    id: kind,
    label: REPOSITORY_KIND_LABELS[kind],
    repositoryCount: scoped.filter(row => repositoryKinds(row).includes(kind)).length,
  }));
}

/**
 * Human-readable perimeter, for the baseline line the panel copies. Both dimensions are named, since
 * the same coverage figure means different things over different perimeters.
 */
export function describePerimeter(perimeter: Perimeter): string {
  const languages = `languages ${describeLanguageSelection(perimeter.languages)}`;

  if (perimeter.kinds.length === 0) {
    return `${languages}, repositories of every kind`;
  }

  const kinds = ALL_REPOSITORY_KINDS.filter(kind => perimeter.kinds.includes(kind))
    .map(kind => REPOSITORY_KIND_LABELS[kind].toLowerCase())
    .join(', ');
  return `${languages}, ${kinds} repositories`;
}
