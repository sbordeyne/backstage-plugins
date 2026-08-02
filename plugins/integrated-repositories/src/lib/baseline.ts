import { CoverageStats } from '../types';
import { describeLanguageSelection } from './languages';

/**
 * Formats the coverage baseline as a single paste-ready line, for the
 * weekly tracking table.
 *
 * The date is injected rather than read from a clock so the result stays deterministic and
 * testable.
 */
export function formatBaseline(stats: CoverageStats, selectedLanguages: readonly string[], isoDate: string): string {
  const scope = describeLanguageSelection(selectedLanguages);
  const coverage = `${stats.coveredPercentage} % integrated, ${stats.uncoveredPercentage} % not integrated`;
  return `${isoDate} — languages ${scope}: ${stats.integrated}/${stats.total} integrated repositories (${coverage})`;
}
