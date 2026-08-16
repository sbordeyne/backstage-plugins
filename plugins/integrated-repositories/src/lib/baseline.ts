import { CoverageStats, Perimeter } from '../types';
import { describePerimeter } from './perimeter';

/**
 * Formats the coverage baseline required by IDP-47 as a single paste-ready line, for the POC's
 * weekly tracking table.
 *
 * The perimeter is named in full: the same percentage means different things over different
 * perimeters, and a baseline that did not say which one was measured could not be compared week to
 * week. The date is injected rather than read from a clock so the result stays deterministic.
 */
export function formatBaseline(stats: CoverageStats, perimeter: Perimeter, isoDate: string): string {
  const coverage = `${stats.coveredPercentage} % integrated, ${stats.uncoveredPercentage} % not integrated`;
  return `${isoDate} — ${describePerimeter(perimeter)}: ${stats.integrated}/${
    stats.total
  } integrated repositories (${coverage})`;
}
