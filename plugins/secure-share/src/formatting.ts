const MINUTE_MS = 60 * 1000;

/**
 * Renders a duration the way the expiry options should read, e.g. `8 hours`.
 *
 * Units are promoted after rounding, so a duration a hair under an hour reads as
 * `1 hour` rather than `60 minutes`.
 *
 * @public
 */
export function formatDuration(durationMs: number): string {
  if (durationMs < MINUTE_MS) {
    return 'less than a minute';
  }
  const minutes = Math.round(durationMs / MINUTE_MS);
  if (minutes < 60) {
    return pluralize(minutes, 'minute');
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return pluralize(hours, 'hour');
  }
  return pluralize(Math.round(hours / 24), 'day');
}

/**
 * Renders how long a paste has left, e.g. `expires in 3 hours`.
 *
 * @public
 */
export function formatTimeRemaining(expiresAt: string, now: Date = new Date()): string {
  const remainingMs = new Date(expiresAt).getTime() - now.getTime();
  if (Number.isNaN(remainingMs)) {
    return 'unknown expiry';
  }
  if (remainingMs <= 0) {
    return 'expired';
  }
  return `expires in ${formatDuration(remainingMs)}`;
}

function pluralize(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}
