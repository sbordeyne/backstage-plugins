/**
 * Normalizes a timestamp read back from the database.
 *
 * The drivers disagree: postgres hands back a `Date`, better-sqlite3 an epoch-ms
 * `number`, and the plain sqlite3 driver a string that may or may not carry a
 * timezone. Every read goes through here so the rest of the code only ever sees
 * a `Date`.
 */
export function parseDbTimestamp(value: Date | string | number): Date {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'number') {
    return new Date(value);
  }
  const hasTimezone = /Z|[+-]\d{2}:?\d{2}$/.test(value);
  return new Date(hasTimezone ? value : `${value}Z`);
}

export function toIsoString(value: Date | string | number): string {
  return parseDbTimestamp(value).toISOString();
}
