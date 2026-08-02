import { matchesRequiredSegment } from './objectPath';

describe('matchesRequiredSegment', () => {
  it('keeps objects sitting directly under the required segment', () => {
    expect(matchesRequiredSegment('reports/2026-07-01/unit/users.json', 'unit')).toBe(true);
  });

  it('rejects objects under a sibling segment', () => {
    expect(matchesRequiredSegment('reports/2026-07-01/integration/users.json', 'unit')).toBe(false);
  });

  it('rejects an object whose required segment is not its direct parent', () => {
    expect(matchesRequiredSegment('reports/unit/nested/users.json', 'unit')).toBe(false);
  });

  it('rejects a bare name when a segment is required', () => {
    expect(matchesRequiredSegment('users.json', 'unit')).toBe(false);
  });

  it('accepts everything when no segment is required', () => {
    expect(matchesRequiredSegment('reports/integration/users.json', '')).toBe(true);
    expect(matchesRequiredSegment('users.json', '')).toBe(true);
  });
});
