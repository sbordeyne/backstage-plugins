import { InputError } from '@backstage/errors';

/**
 * Position in the run list: runs are ordered by `(artifact_created_at DESC, id DESC)`,
 * so both parts are needed to break ties without skipping or repeating a row.
 */
export interface RunCursor {
  /** Epoch milliseconds — engine-independent, unlike a serialized timestamp. */
  t: number;
  id: string;
}

export function encodeRunCursor(cursor: RunCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf-8').toString('base64url');
}

export function decodeRunCursor(value: string): RunCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf-8'));
  } catch {
    throw new InputError(`Malformed cursor '${value}'`);
  }

  const candidate = parsed as Partial<RunCursor>;
  if (typeof candidate?.t !== 'number' || !Number.isFinite(candidate.t) || typeof candidate?.id !== 'string') {
    throw new InputError(`Malformed cursor '${value}'`);
  }
  return { t: candidate.t, id: candidate.id };
}

/** Results are ordered by the monotonic `seq`, so the cursor is just that integer. */
export function encodeResultCursor(seq: number): string {
  return String(seq);
}

export function decodeResultCursor(value: string): number {
  const seq = Number(value);
  if (!Number.isInteger(seq) || seq < 0) {
    throw new InputError(`Malformed cursor '${value}'`);
  }
  return seq;
}
