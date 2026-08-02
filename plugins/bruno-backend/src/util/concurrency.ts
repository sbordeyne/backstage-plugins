/**
 * Runs `worker` over every item with at most `limit` in flight.
 *
 * Hand-rolled rather than pulling in `p-limit`: v4+ is ESM-only and breaks the
 * jest/CJS transform, and v3 would be a second copy of what backend-defaults
 * already bundles.
 */
export async function mapWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const effectiveLimit = Math.max(1, Math.min(limit, items.length));
  let cursor = 0;

  async function runNext(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: effectiveLimit }, () => runNext()));
}
