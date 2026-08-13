import { useCallback, useEffect, useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import {
  FUNCTION_SETS,
  FUNCTION_SET_DESCRIPTIONS,
  FUNCTION_SET_LABELS,
  useGoTemplateEngine,
  useWasmUrl,
} from '../../engine';
import type { FunctionDoc, FunctionSet, RenderResponse } from '../../engine';
import { FunctionReference } from './FunctionReference';
import { AdvancedSettings, type AdvancedSettingsValue } from './AdvancedSettings';
import { buildUsage } from './FunctionDocPanel';
import { SAMPLES } from './samples';
import { clearPersistedState, usePersistentState } from './usePersistentState';
import { useEditorTheme } from './useEditorTheme';
import styles from './GoTemplatePlayground.module.css';

const DEFAULT_ADVANCED: AdvancedSettingsValue = {
  dataFormat: 'yaml',
  leftDelim: '{{',
  rightDelim: '}}',
  missingKey: 'default',
  releaseName: 'playground',
  releaseNamespace: 'default',
  kubeVersion: '',
};

const DATA_PANE_HINTS: Record<FunctionSet, string> = {
  helm: 'exposed as .Values',
  eso: 'flat secret keys, addressed as .key',
  sprig: 'the template context, addressed as .key',
  sprout: 'the template context, addressed as .key',
};

/** Drafts are kept per function set, so switching tabs never discards work. */
type Drafts = Record<FunctionSet, { template: string; data: string }>;

const INITIAL_DRAFTS: Drafts = {
  sprig: { template: SAMPLES.sprig.template, data: SAMPLES.sprig.data },
  sprout: { template: SAMPLES.sprout.template, data: SAMPLES.sprout.data },
  helm: { template: SAMPLES.helm.template, data: SAMPLES.helm.data },
  eso: { template: SAMPLES.eso.template, data: SAMPLES.eso.data },
};

const EDITOR_OPTIONS = {
  minimap: { enabled: false },
  fontSize: 13,
  scrollBeyondLastLine: false,
  wordWrap: 'on',
  automaticLayout: true,
  padding: { top: 8, bottom: 8 },
} as const;

export const GoTemplatePlayground = () => {
  const { engine, loading, error: loadError } = useGoTemplateEngine();
  const wasmUrl = useWasmUrl();
  const editorTheme = useEditorTheme();

  const [functionSet, setFunctionSet] = usePersistentState<FunctionSet>('functionSet', 'sprig');
  const [drafts, setDrafts] = usePersistentState<Drafts>('drafts', INITIAL_DRAFTS);
  const [advanced, setAdvanced] = usePersistentState<AdvancedSettingsValue>('advanced', DEFAULT_ADVANCED);
  const [outputCollapsed, setOutputCollapsed] = usePersistentState('outputCollapsed', false);

  // A draft written by an older version may be missing a set that has since
  // been added, so fall back rather than handing undefined to the editor.
  const draft = drafts[functionSet] ?? INITIAL_DRAFTS[functionSet];
  const { template, data } = draft;

  const isHelm = functionSet === 'helm';
  const isEso = functionSet === 'eso';

  const setDraftField = useCallback(
    (field: 'template' | 'data', value: string) =>
      setDrafts(current => ({
        ...current,
        [functionSet]: {
          ...(current[functionSet] ?? INITIAL_DRAFTS[functionSet]),
          [field]: value,
        },
      })),
    [functionSet, setDrafts],
  );

  const setAdvancedField = useCallback(
    <K extends keyof AdvancedSettingsValue>(key: K, next: AdvancedSettingsValue[K]) =>
      setAdvanced(current => ({ ...current, [key]: next })),
    [setAdvanced],
  );

  const resetEverything = useCallback(() => {
    clearPersistedState();
    setDrafts(INITIAL_DRAFTS);
    setAdvanced(DEFAULT_ADVANCED);
  }, [setDrafts, setAdvanced]);

  const [result, setResult] = useState<RenderResponse | undefined>();

  // Re-render on every keystroke. Calls are a synchronous hop into the Go
  // runtime and measured in single-digit milliseconds, so a debounce would add
  // latency without saving meaningful work.
  useEffect(() => {
    if (!engine) return;
    setResult(
      engine.render({
        functionSet,
        template,
        data,
        dataFormat: advanced.dataFormat,
        leftDelim: advanced.leftDelim,
        rightDelim: advanced.rightDelim,
        missingKey: advanced.missingKey,
        releaseName: advanced.releaseName,
        releaseNamespace: advanced.releaseNamespace,
        kubeVersion: advanced.kubeVersion.trim() || undefined,
      }),
    );
  }, [engine, functionSet, template, data, advanced]);

  const catalog = useMemo(() => engine?.functions(), [engine]);
  const functions = catalog?.[functionSet] ?? [];

  // Appends a ready-to-edit call rather than a bare name, so the inserted line
  // is at least syntactically complete.
  const insertFunction = useCallback(
    (fn: FunctionDoc) => {
      const [usage] = buildUsage(fn);
      const line = usage.replace(/^\{\{/, advanced.leftDelim).replace(/\}\}$/, advanced.rightDelim);
      setDraftField('template', `${template}\n${line}`);
    },
    [advanced.leftDelim, advanced.rightDelim, setDraftField, template],
  );

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.loadingTitle}>Starting the Go template engine…</div>
        <p className={styles.loadingHint}>
          Downloading the WebAssembly build of Go’s <code className={styles.code}>text/template</code> with the sprig,
          sprout, helm and external-secrets function sets. It is a large one-time download and is cached by the browser
          afterwards.
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={`${styles.loading} ${styles.loadFailure}`}>
        <div className={styles.loadingTitle}>Could not start the template engine</div>
        <p className={styles.loadingHint}>
          {loadError.message}
          <br />
          <br />
          It was fetched from <code className={styles.code}>{wasmUrl}</code>. If your Backstage deployment blocks public
          CDNs, host <code className={styles.code}>gotemplate.wasm</code> yourself and set{' '}
          <code className={styles.code}>gotemplate.wasmUrl</code> in your app-config.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.setRow}>
        <div className={styles.setTabs} role="tablist" aria-label="Function set">
          {FUNCTION_SETS.map(set => (
            <button
              key={set}
              type="button"
              role="tab"
              aria-selected={set === functionSet}
              className={`${styles.setTab} ${set === functionSet ? styles.setTabActive : ''}`}
              onClick={() => setFunctionSet(set)}
            >
              {FUNCTION_SET_LABELS[set]}
            </button>
          ))}
        </div>

        <AdvancedSettings
          value={advanced}
          onChange={setAdvancedField}
          showHelmFields={isHelm}
          missingKeyLocked={isEso}
          onReset={resetEverything}
        />
      </div>

      <p className={styles.setDescription}>{FUNCTION_SET_DESCRIPTIONS[functionSet]}</p>

      <FunctionReference functions={functions} functionSet={functionSet} onInsert={insertFunction} />

      <div className={`${styles.workspace} ${outputCollapsed ? styles.workspaceCollapsed : ''}`}>
        <div className={styles.pane}>
          <div className={styles.paneHeader}>
            <span>Template</span>
            <span className={styles.paneHint}>
              {advanced.leftDelim} … {advanced.rightDelim}
            </span>
          </div>
          <div className={styles.editorHost}>
            <Editor
              height="100%"
              theme={editorTheme}
              language="handlebars"
              value={template}
              onChange={value => setDraftField('template', value ?? '')}
              options={EDITOR_OPTIONS}
            />
          </div>
        </div>

        {outputCollapsed ? (
          <button
            type="button"
            className={`${styles.pane} ${styles.outputCollapsed}`}
            onClick={() => setOutputCollapsed(false)}
            aria-label="Expand output"
            title="Expand output"
          >
            <span className={styles.outputCollapsedLabel}>Output</span>
            {result?.error && <span className={styles.outputCollapsedBadge}>error</span>}
          </button>
        ) : (
          <div className={styles.pane}>
            <div className={styles.paneHeader}>
              <span>Output</span>
              <span className={styles.paneHeaderActions}>
                <span className={styles.status}>{result ? `${result.durationMs}ms` : ''}</span>
                <button
                  type="button"
                  className={styles.collapseButton}
                  onClick={() => setOutputCollapsed(true)}
                  aria-label="Collapse output"
                  title="Collapse output to widen the template"
                >
                  ⟩⟩
                </button>
              </span>
            </div>

            {result?.error && (
              <div className={styles.error}>
                <span className={styles.errorPhase}>{result.errorPhase}</span>
                {result.error}
              </div>
            )}

            <pre className={styles.output}>
              {result?.output ? (
                result.output
              ) : (
                <span className={styles.outputEmpty}>
                  {result?.error ? 'No output was produced.' : 'Output appears here as you type.'}
                </span>
              )}
            </pre>
          </div>
        )}
      </div>

      <div className={`${styles.pane} ${styles.dataPane}`}>
        <div className={styles.paneHeader}>
          <span>{isHelm ? 'Values' : 'Data'}</span>
          <span className={styles.paneHint}>{DATA_PANE_HINTS[functionSet]}</span>
        </div>
        <div className={styles.editorHost}>
          <Editor
            height="100%"
            theme={editorTheme}
            language={advanced.dataFormat}
            value={data}
            onChange={value => setDraftField('data', value ?? '')}
            options={EDITOR_OPTIONS}
          />
        </div>
      </div>
    </div>
  );
};

export default GoTemplatePlayground;
