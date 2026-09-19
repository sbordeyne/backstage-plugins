import { InputError } from '@backstage/errors';

/**
 * Position in a source's version list, which is ordered by `(sort_key DESC, id DESC)`.
 *
 * Both parts are needed: `sort_key` alone ties whenever two tags normalize to the
 * same version, and a tie would either skip or repeat a row.
 */
export interface VersionCursor {
  k: string;
  id: string;
}

/**
 * Position in a resource's change list.
 *
 * Changes are ordered by the monotonic `seq` assigned at ingest, so the cursor is
 * that integer and nothing else.
 */
export type ChangeCursor = number;

/**
 * Position in a search result page.
 *
 * Results run kinds first and then property paths, so the cursor names which of
 * the two lists it is inside as well as the position within it. A reader looking
 * for `ingress` wants the `Ingress` kind before a property that mentions it, and
 * a single ordered stream is what lets one "load more" button walk both.
 */
export type SearchCursor =
  | { t: 'r'; rank: number; kind: string; id: string }
  | { t: 'p'; depth: number; kind: string; rid: string; seq: number };

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf-8').toString('base64url');
}

function decode(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf-8'));
  } catch {
    throw new InputError(`Malformed cursor '${value}'`);
  }
}

export function encodeVersionCursor(cursor: VersionCursor): string {
  return encode(cursor);
}

export function decodeVersionCursor(value: string): VersionCursor {
  const parsed = decode(value) as Partial<VersionCursor>;
  if (typeof parsed?.k !== 'string' || typeof parsed?.id !== 'string') {
    throw new InputError(`Malformed cursor '${value}'`);
  }
  return { k: parsed.k, id: parsed.id };
}

export function encodeChangeCursor(seq: number): string {
  return String(seq);
}

export function decodeChangeCursor(value: string): ChangeCursor {
  const seq = Number(value);
  if (!Number.isInteger(seq) || seq < 0) {
    throw new InputError(`Malformed cursor '${value}'`);
  }
  return seq;
}

export function encodeSearchCursor(cursor: SearchCursor): string {
  return encode(cursor);
}

export function decodeSearchCursor(value: string): SearchCursor {
  const parsed = decode(value) as Partial<SearchCursor> & { t?: string };

  if (parsed?.t === 'r') {
    const candidate = parsed as Partial<Extract<SearchCursor, { t: 'r' }>>;
    if (
      typeof candidate.rank !== 'number' ||
      !Number.isFinite(candidate.rank) ||
      typeof candidate.kind !== 'string' ||
      typeof candidate.id !== 'string'
    ) {
      throw new InputError(`Malformed cursor '${value}'`);
    }
    return { t: 'r', rank: candidate.rank, kind: candidate.kind, id: candidate.id };
  }

  if (parsed?.t === 'p') {
    const candidate = parsed as Partial<Extract<SearchCursor, { t: 'p' }>>;
    if (
      typeof candidate.depth !== 'number' ||
      !Number.isFinite(candidate.depth) ||
      typeof candidate.kind !== 'string' ||
      typeof candidate.rid !== 'string' ||
      typeof candidate.seq !== 'number' ||
      !Number.isInteger(candidate.seq)
    ) {
      throw new InputError(`Malformed cursor '${value}'`);
    }
    return { t: 'p', depth: candidate.depth, kind: candidate.kind, rid: candidate.rid, seq: candidate.seq };
  }

  throw new InputError(`Malformed cursor '${value}'`);
}
