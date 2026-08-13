import { useMemo, useState } from 'react';
import type { FunctionDoc, FunctionSet } from '../../engine';
import { FUNCTION_SET_DOC_URLS, FUNCTION_SET_LABELS } from '../../engine';
import { FunctionDocPanel } from './FunctionDocPanel';
import styles from './GoTemplatePlayground.module.css';

interface Props {
  functions: FunctionDoc[];
  functionSet: FunctionSet;
  /** Inserts a call into the template; offered from the doc panel, not on click. */
  onInsert: (fn: FunctionDoc) => void;
}

/**
 * Lists the functions the selected set exposes, grouped by category. This is not
 * garnish: sprig and sprout disagree on almost every name (`upper` vs
 * `toUpper`), so without a per-set list the first thing a user hits is
 * "function not defined".
 */
export const FunctionReference = ({ functions, functionSet, onInsert }: Props) => {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | undefined>();

  const matches = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return functions;
    return functions.filter(fn => fn.name.toLowerCase().includes(needle) || fn.category.toLowerCase().includes(needle));
  }, [functions, filter]);

  // Grouped into the categories the engine reports, ordered by size so the
  // categories someone is most likely to want are nearest the top.
  const grouped = useMemo(() => {
    const byCategory = new Map<string, FunctionDoc[]>();
    for (const fn of matches) {
      const bucket = byCategory.get(fn.category);
      if (bucket) bucket.push(fn);
      else byCategory.set(fn.category, [fn]);
    }
    return [...byCategory.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  }, [matches]);

  const selectedDoc = useMemo(() => functions.find(fn => fn.name === selected), [functions, selected]);

  return (
    <div className={styles.reference}>
      <div className={styles.referenceHeader}>
        <button type="button" className={styles.button} onClick={() => setOpen(o => !o)} aria-expanded={open}>
          {open ? 'Hide' : 'Show'} functions
        </button>
        <span className={styles.referenceTitle}>
          {functions.length} in {FUNCTION_SET_LABELS[functionSet]}
        </span>
        {open && (
          <input
            className={`${styles.input} ${styles.referenceFilter}`}
            placeholder="Filter by name or category…"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            aria-label="Filter functions"
          />
        )}
      </div>

      {open && (
        <div className={styles.referenceBody}>
          <div className={styles.categoryList}>
            {grouped.length === 0 ? (
              <div className={styles.noResults}>Nothing matches “{filter}” in this set.</div>
            ) : (
              grouped.map(([category, fns]) => (
                <div key={category}>
                  <div className={styles.categoryName}>
                    {category} · {fns.length}
                  </div>
                  <div className={styles.functionList}>
                    {fns.map(fn => (
                      <button
                        type="button"
                        key={fn.name}
                        className={`${styles.functionChip} ${fn.name === selected ? styles.functionChipActive : ''}`}
                        aria-pressed={fn.name === selected}
                        onClick={() => setSelected(fn.name)}
                      >
                        {fn.name}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>

          <FunctionDocPanel
            doc={selectedDoc}
            docsUrl={FUNCTION_SET_DOC_URLS[functionSet]}
            setLabel={FUNCTION_SET_LABELS[functionSet]}
            onInsert={onInsert}
          />
        </div>
      )}
    </div>
  );
};
