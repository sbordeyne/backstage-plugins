import { useEffect, useState } from 'react';
import { configApiRef, useApi } from '@backstage/core-plugin-api';
import { loadEngine } from './loadEngine';
import type { GoTemplateEngine } from './types';

// Read from the manifest rather than restated here, so a version bump cannot leave the
// default URL pointing at a release that holds a different build of the engine. The values
// are inlined at build time; nothing reads package.json at runtime.
import { name, repository, version } from '../../package.json';

/**
 * The release the engine is attached to. Tags in this monorepo are the package name without
 * its scope, plus the version — the same shape the release workflow computes when it uploads
 * `gotemplate.wasm` as a release asset.
 */
const RELEASE_TAG = `${name.replace(/^@[^/]+\//, '')}-${version}`;

const DEFAULT_WASM_URL = `${repository.url}/releases/download/${RELEASE_TAG}/gotemplate.wasm`;

/**
 * Resolves where to fetch the engine from. The default is the GitHub release
 * matching this package's version, which some deployments cannot reach;
 * `gotemplate.wasmUrl` in app-config points the tool at a self-hosted copy
 * instead.
 */
export function useWasmUrl(): string {
  const config = useApi(configApiRef);
  return config.getOptionalString('gotemplate.wasmUrl') ?? DEFAULT_WASM_URL;
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
