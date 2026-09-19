/**
 * SQLite compiles a multi-row insert into `insert ... select ? union all select ?...`,
 * so it hits SQLITE_MAX_COMPOUND_SELECT (500 terms) no matter how few columns
 * each row has. Postgres instead caps total bind parameters at 65535.
 */
const SQLITE_MAX_ROWS_PER_INSERT = 500;
const PG_MAX_BIND_PARAMS = 65535;

export function chunkSizeFor(client: string, columnCount: number): number {
  if (client.includes('sqlite')) {
    return SQLITE_MAX_ROWS_PER_INSERT;
  }
  return Math.max(1, Math.floor((PG_MAX_BIND_PARAMS * 0.9) / Math.max(1, columnCount)));
}

export function chunked<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error(`Chunk size must be positive, got ${size}`);
  }
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
