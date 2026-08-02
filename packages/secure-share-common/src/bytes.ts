import { InputError } from '@backstage/errors';

const BYTES_PER_UNIT: Record<string, number> = {
  B: 1,
  KB: 1024,
  MB: 1024 * 1024,
  GB: 1024 * 1024 * 1024,
};

const BYTE_SIZE_PATTERN = /^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i;

/**
 * Parses a human readable byte size such as `100MB` into a number of bytes.
 *
 * Units are binary multiples of 1024, so `1KB` is 1024 bytes.
 *
 * @public
 */
export function parseByteSize(value: string): number {
  const match = BYTE_SIZE_PATTERN.exec(value.trim());
  if (!match) {
    throw new InputError(`Invalid byte size '${value}', expected a number followed by B, KB, MB or GB`);
  }

  const [, amount, unit] = match;
  const bytes = Number(amount) * BYTES_PER_UNIT[unit.toUpperCase()];
  if (bytes <= 0) {
    throw new InputError(`Invalid byte size '${value}', must be greater than zero`);
  }
  return Math.floor(bytes);
}

/**
 * Formats a number of bytes for display, using the largest unit that keeps the
 * value above 1.
 *
 * @public
 */
export function formatByteSize(bytes: number): string {
  const units = ['GB', 'MB', 'KB', 'B'];
  for (const unit of units) {
    const unitSize = BYTES_PER_UNIT[unit];
    if (bytes >= unitSize) {
      const value = bytes / unitSize;
      const rounded = Number.isInteger(value) ? value.toString() : value.toFixed(1);
      return `${rounded}${unit}`;
    }
  }
  return '0B';
}
