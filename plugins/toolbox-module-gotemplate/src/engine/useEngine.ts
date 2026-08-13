import { useEffect, useState } from 'react';
import { configApiRef, useApi } from '@backstage/core-plugin-api';
import { loadEngine } from './loadEngine';
import type { GoTemplateEngine } from './types';

/**
 * Bumped in lockstep with the package version so the default CDN URL always
 * points at the engine that was built from this source.
 */
const PACKAGE_VERSION = '0.1.0';
const PACKAGE_NAME = '@sbordeyne/backstage-plugin-toolbox-module-gotemplate';

const DEFAULT_WASM_URL = `https://cdn.jsdelivr.net/npm/${PACKAGE_NAME}@${PACKAGE_VERSION}/static/gotemplate.wasm`;

/**
 * Resolves where to fetch the engine from. The default is a public CDN, which
 * many Backstage deployments block; `gotemplate.wasmUrl` in app-config points
 * the tool at a self-hosted copy instead.
 */
export function useWasmUrl(): string {
  const config = useApi(configApiRef);
  return (
    config.getOptionalString('gotemplate.wasmUrl') ?? DEFAULT_WASM_URL
  );
}

export interface EngineState {
  engine?: GoTemplateEngine;
  loading: boolean;
  error?: Error;
}

export function useGoTemplateEngine(): EngineState {
  const wasmUrl = useWasmUrl();
  const [state, setState] = useState<EngineState>({ loading: true });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true });

    loadEngine(wasmUrl).then(
      engine => {
        if (!cancelled) setState({ engine, loading: false });
      },
      error => {
        if (!cancelled) setState({ loading: false, error });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [wasmUrl]);

  return state;
}
