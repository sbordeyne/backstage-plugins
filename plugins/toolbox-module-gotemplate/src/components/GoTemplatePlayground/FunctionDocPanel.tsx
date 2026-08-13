import type { FunctionDoc } from '../../engine';
import styles from './GoTemplatePlayground.module.css';

interface Props {
  doc?: FunctionDoc;
  docsUrl: string;
  setLabel: string;
  onInsert: (fn: FunctionDoc) => void;
}

/**
 * Splits the parameter list out of a rendered signature such as
 * `trunc(int, string) string`. Nested types like `map[string]any` contain no
 * top-level commas, so a depth-aware split is enough — no real parser needed.
 */
export function parseParams(signature: string): string[] {
  const open = signature.indexOf('(');
  if (open === -1) return [];

  let depth = 0;
  let current = '';
  const params: string[] = [];

  for (let i = open; i < signature.length; i++) {
    const ch = signature[i];
    if (ch === '(' || ch === '[') {
      depth++;
      if (depth === 1) continue;
    } else if (ch === ')' || ch === ']') {
      depth--;
      if (depth === 0) break;
    }
    if (ch === ',' && depth === 1) {
      params.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) params.push(current.trim());
  return params.filter(Boolean);
}

/** A placeholder name for a parameter, derived from its type. */
function placeholder(type: string, index: number): string {
  const bare = type.replace(/^\.\.\./, '');
  const position = index + 1;

  // Composite types read better as their shape than as their element type:
  // `[]string` is a list, not a "liststring".
  if (bare.startsWith('[]')) return `list${position}`;
  if (bare.startsWith('map[')) return `dict${position}`;

  // Drop any package qualifier, e.g. `time.Duration` -> `Duration`.
  const label = bare.split('.').pop()?.replace(/[^A-Za-z0-9]/g, '') ?? '';
  return `${label || 'arg'}${position}`;
}

/**
 * Builds a call example. Go's template pipeline passes the piped value as the
 * *last* argument, so the pipeline form has to move the final parameter to the
 * front rather than simply prefixing the call.
 */
export function buildUsage(doc: FunctionDoc): string[] {
  const params = parseParams(doc.signature);
  if (params.length === 0) return [`{{ ${doc.name} }}`];

  const args = params.map((p, i) =>
    p.startsWith('...') ? `${placeholder(p, i)}…` : placeholder(p, i),
  );
  const direct = `{{ ${doc.name} ${args.join(' ')} }}`;

  const last = args[args.length - 1];
  const rest = args.slice(0, -1);
  const piped = `{{ ${last} | ${doc.name}${rest.length ? ` ${rest.join(' ')}` : ''} }}`;

  return params.length === 1 ? [direct, piped] : [direct, piped];
}

export const FunctionDocPanel = ({
  doc,
  docsUrl,
  setLabel,
  onInsert,
}: Props) => {
  if (!doc) {
    return (
      <div className={styles.doc}>
        <div className={styles.docEmpty}>
          Pick a function to see its signature and how to call it. Signatures are
          read from the real Go functions, so they match what the engine accepts.
        </div>
      </div>
    );
  }

  const usage = buildUsage(doc);

  return (
    <div className={styles.doc}>
      <h3 className={styles.docName}>{doc.name}</h3>
      <span className={styles.docCategory}>{doc.category}</span>

      <div className={styles.docLabel}>Signature</div>
      <pre className={styles.docSignature}>{doc.signature}</pre>

      <div className={styles.docLabel}>Usage</div>
      <pre className={styles.docUsage}>{usage.join('\n')}</pre>

      <div className={styles.docActions}>
        <button
          type="button"
          className={styles.button}
          onClick={() => onInsert(doc)}
        >
          Insert into template
        </button>
        <a
          className={styles.docLink}
          href={docsUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {setLabel} docs ↗
        </a>
      </div>
    </div>
  );
};
