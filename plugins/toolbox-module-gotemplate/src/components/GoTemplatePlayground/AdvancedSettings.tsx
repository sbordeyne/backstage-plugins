import { useEffect, useRef, useState } from 'react';
import type { DataFormat, MissingKeyMode } from '../../engine';
import styles from './GoTemplatePlayground.module.css';

const MISSING_KEY_MODES: MissingKeyMode[] = ['default', 'zero', 'error'];

export interface AdvancedSettingsValue {
  dataFormat: DataFormat;
  leftDelim: string;
  rightDelim: string;
  missingKey: MissingKeyMode;
  releaseName: string;
  releaseNamespace: string;
  kubeVersion: string;
}

interface Props {
  value: AdvancedSettingsValue;
  onChange: <K extends keyof AdvancedSettingsValue>(key: K, next: AdvancedSettingsValue[K]) => void;
  /** Helm-only fields are hidden for the other sets. */
  showHelmFields: boolean;
  /** external-secrets pins missingkey=error, so the control is locked there. */
  missingKeyLocked: boolean;
  onReset: () => void;
}

/**
 * These settings are rarely touched, so they live behind a menu rather than
 * taking up a permanent row above the editors.
 */
export const AdvancedSettings = ({ value, onChange, showHelmFields, missingKeyLocked, onReset }: Props) => {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  // Dismiss on outside click and on Escape, the two things a menu is expected
  // to do and the reason this is not just a details/summary.
  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event: MouseEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.advancedAnchor} ref={anchorRef}>
      <button
        type="button"
        className={`${styles.iconButton} ${open ? styles.iconButtonActive : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Advanced settings"
        title="Advanced settings"
      >
        <span className={styles.hamburger} />
      </button>

      {open && (
        <div className={styles.advancedPanel} role="dialog" aria-label="Advanced settings">
          <p className={styles.advancedTitle}>Advanced</p>

          <div className={styles.advancedGrid}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Data format</span>
              <select
                className={styles.select}
                value={value.dataFormat}
                onChange={e => onChange('dataFormat', e.target.value as DataFormat)}
              >
                <option value="yaml">YAML</option>
                <option value="json">JSON</option>
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Missing key</span>
              <select
                className={styles.select}
                value={missingKeyLocked ? 'error' : value.missingKey}
                disabled={missingKeyLocked}
                title={missingKeyLocked ? 'external-secrets always renders with missingkey=error' : undefined}
                onChange={e => onChange('missingKey', e.target.value as MissingKeyMode)}
              >
                {MISSING_KEY_MODES.map(mode => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Left delimiter</span>
              <input
                className={styles.input}
                value={value.leftDelim}
                onChange={e => onChange('leftDelim', e.target.value)}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Right delimiter</span>
              <input
                className={styles.input}
                value={value.rightDelim}
                onChange={e => onChange('rightDelim', e.target.value)}
              />
            </label>

            {showHelmFields && (
              <>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Release name</span>
                  <input
                    className={styles.input}
                    value={value.releaseName}
                    onChange={e => onChange('releaseName', e.target.value)}
                  />
                </label>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Release namespace</span>
                  <input
                    className={styles.input}
                    value={value.releaseNamespace}
                    onChange={e => onChange('releaseNamespace', e.target.value)}
                  />
                </label>

                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Kube version</span>
                  <input
                    className={styles.input}
                    placeholder="v1.30.0"
                    value={value.kubeVersion}
                    onChange={e => onChange('kubeVersion', e.target.value)}
                  />
                </label>
              </>
            )}
          </div>

          {missingKeyLocked && (
            <p className={styles.fieldHint}>
              external-secrets renders with <code>missingkey=error</code>, so a missing key always fails here — as it
              would in the operator.
            </p>
          )}

          <p className={styles.fieldHint}>
            Your templates, data and these settings are kept in this browser and restored when you come back.
          </p>

          <div className={styles.advancedActions}>
            <button type="button" className={styles.button} onClick={onReset}>
              Reset and restore samples
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
