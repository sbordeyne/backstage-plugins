import { formatDuration, formatTimeRemaining } from './formatting';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

describe('formatDuration', () => {
  it.each([
    [0, 'less than a minute'],
    [20 * 1000, 'less than a minute'],
    [MINUTE_MS, '1 minute'],
    [30 * MINUTE_MS, '30 minutes'],
    [HOUR_MS, '1 hour'],
    [8 * HOUR_MS, '8 hours'],
    [DAY_MS, '1 day'],
    [7 * DAY_MS, '7 days'],
  ])('formats %s ms as %s', (durationMs, expected) => {
    expect(formatDuration(durationMs)).toBe(expected);
  });

  it.each([
    [HOUR_MS - 1, '1 hour'],
    [DAY_MS - 1, '1 day'],
    [59 * MINUTE_MS + 59 * 1000, '1 hour'],
  ])('promotes %s ms to %s rather than reporting 60 of the smaller unit', (durationMs, expected) => {
    expect(formatDuration(durationMs)).toBe(expected);
  });
});

describe('formatTimeRemaining', () => {
  const now = new Date('2026-08-01T10:00:00.000Z');

  it.each([
    ['2026-08-01T13:00:00.000Z', 'expires in 3 hours'],
    ['2026-08-02T10:00:00.000Z', 'expires in 1 day'],
    ['2026-08-01T10:00:30.000Z', 'expires in less than a minute'],
  ])('describes %s as %s', (expiresAt, expected) => {
    expect(formatTimeRemaining(expiresAt, now)).toBe(expected);
  });

  it('reports an expiry in the past as expired', () => {
    expect(formatTimeRemaining('2026-08-01T09:00:00.000Z', now)).toBe('expired');
  });

  it('does not pretend to know an unparseable expiry', () => {
    expect(formatTimeRemaining('not a date', now)).toBe('unknown expiry');
  });
});
