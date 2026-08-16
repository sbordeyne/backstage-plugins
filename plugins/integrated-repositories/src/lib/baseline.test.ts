import { formatBaseline } from './baseline';
import { ALL_REPOSITORY_KINDS } from './labels';
import { CoverageStats, Perimeter, UNKNOWN_LANGUAGE } from '../types';

function perimeter(overrides: Partial<Perimeter> = {}): Perimeter {
  return { languages: [], kinds: ALL_REPOSITORY_KINDS, ...overrides };
}

function stats(overrides: Partial<CoverageStats> = {}): CoverageStats {
  return {
    total: 148,
    integrated: 78,
    notIntegrated: 70,
    drift: 3,
    nestedOnly: 2,
    unknown: 0,
    entityCount: 152,
    uncoveredPercentage: 47.3,
    coveredPercentage: 52.7,
    ...overrides,
  };
}

describe('formatBaseline', () => {
  it('formats a paste-ready line for a language selection', () => {
    const scoped = stats({ total: 89, integrated: 42, uncoveredPercentage: 52.8, coveredPercentage: 47.2 });

    expect(formatBaseline(scoped, perimeter({ languages: ['Java', 'Kotlin'] }), '2026-07-31')).toBe(
      '2026-07-31 — languages Java, Kotlin, active, archived, fork, empty repositories: 42/89 integrated repositories (47.2 % integrated, 52.8 % not integrated)',
    );
  });

  it('formats a paste-ready line for the whole organisation', () => {
    expect(formatBaseline(stats(), perimeter(), '2026-08-03')).toBe(
      '2026-08-03 — languages all languages, active, archived, fork, empty repositories: 78/148 integrated repositories (52.7 % integrated, 47.3 % not integrated)',
    );
  });

  it('names a narrowed perimeter, since the same percentage means different things over different ones', () => {
    expect(formatBaseline(stats(), perimeter({ kinds: ['active'] }), '2026-08-03')).toContain(
      'languages all languages, active repositories:',
    );
  });

  it('renders the unknown-language sentinel readably', () => {
    expect(formatBaseline(stats(), perimeter({ languages: [UNKNOWN_LANGUAGE] }), '2026-08-03')).toContain(
      'languages Unknown,',
    );
  });

  it('handles an empty scope', () => {
    const empty = stats({ total: 0, integrated: 0, notIntegrated: 0, uncoveredPercentage: 0, coveredPercentage: 0 });

    expect(formatBaseline(empty, perimeter({ languages: ['Java'] }), '2026-08-03')).toBe(
      '2026-08-03 — languages Java, active, archived, fork, empty repositories: 0/0 integrated repositories (0 % integrated, 0 % not integrated)',
    );
  });
});
