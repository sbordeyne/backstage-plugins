import { formatDate } from './labels';

describe('formatDate', () => {
  it('keeps the ISO-8601 day of a timestamp', () => {
    expect(formatDate('2026-07-30T09:12:34Z')).toBe('2026-07-30');
  });

  it('normalises an offset to UTC, so two rows pushed at the same instant read alike', () => {
    expect(formatDate('2026-07-30T23:30:00+02:00')).toBe('2026-07-30');
    expect(formatDate('2026-07-31T00:30:00+02:00')).toBe('2026-07-30');
  });

  it('accepts a bare date', () => {
    expect(formatDate('2026-07-30')).toBe('2026-07-30');
  });

  it('renders a repository GitHub reports no push date for as a dash', () => {
    expect(formatDate(undefined)).toBe('—');
  });

  it('renders an unparseable timestamp as a dash rather than throwing on a RangeError', () => {
    expect(formatDate('not-a-date')).toBe('—');
    expect(formatDate('')).toBe('—');
  });
});
