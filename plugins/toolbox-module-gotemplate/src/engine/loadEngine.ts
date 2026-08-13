import type {
  FunctionCatalog,
  GoTemplateEngine,
  RenderRequest,
  RenderResponse,
} from './types';

// The Go distribution's loader shim, vendored under src/engine and refreshed by
// wasm/build.sh so it always matches the compiler that produced the module.
//
// It is imported by name rather than for its side effect on purpose: the shim is
// an IIFE that only assigns `globalThis.Go`, so a side-effect-only import binds
// nothing and gets tree-shaken out of the bundle — which surfaces later as
// "globalThis.Go is not a constructor". The named binding keeps it alive.
import { Go as GoRuntime } from './wasm_exec.js';

type GoRuntimeConstructor = new () => {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
};

declare global {
  // eslint-disable-next-line no-var
  var __gotemplateRender: ((request: string) => string) | undefined;
  // eslint-disable-next-line no-var
  var __gotemplateFunctions: (() => string) | undefined;
  // eslint-disable-next-line no-var
  var __gotemplateReady: (() => void) | undefined;
}

/**
 * The engine is a single large WebAssembly module, so it is instantiated once
 * per browser session and shared by every mount of the tool.
 */
let enginePromise: Promise<GoTemplateEngine> | undefined;

async function instantiate(wasmUrl: string): Promise<GoTemplateEngine> {
  const Go = GoRuntime as unknown as GoRuntimeConstructor | undefined;
  if (typeof Go !== 'function') {
    throw new Error(
      'the Go runtime shim did not load; wasm_exec.js was likely dropped from the bundle',
    );
  }
  const go = new Go();

  const response = await fetch(wasmUrl);
  if (!response.ok) {
    throw new Error(
      `could not download the template engine from ${wasmUrl} (HTTP ${response.status})`,
    );
  }

  // instantiateStreaming compiles off the main thread, but it insists on an
  // exact wasm content type; fall back to buffering when the server does not
  // set one (a common default for static file hosting).
  let instance: WebAssembly.Instance;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/wasm')) {
    ({ instance } = await WebAssembly.instantiateStreaming(
      response,
      go.importObject,
    ));
  } else {
    const bytes = await response.arrayBuffer();
    ({ instance } = await WebAssembly.instantiate(bytes, go.importObject));
  }

  // The Go program parks in `select {}` forever, so `run` never resolves. It
  // signals readiness through this callback instead of us polling for exports.
  const ready = new Promise<void>((resolve, reject) => {
    globalThis.__gotemplateReady = resolve;
    go.run(instance).then(
      () => reject(new Error('the template engine exited unexpectedly')),
      reject,
    );
  });
  await ready;

  const render = globalThis.__gotemplateRender;
  const functions = globalThis.__gotemplateFunctions;
  if (!render || !functions) {
    throw new Error('the template engine started but exported no entrypoints');
  }

  return {
    render: (request: RenderRequest): RenderResponse =>
      JSON.parse(render(JSON.stringify(request))) as RenderResponse,
    functions: (): FunctionCatalog =>
      JSON.parse(functions()) as FunctionCatalog,
  };
}

/**
 * Downloads and starts the Go template engine, reusing the in-flight or
 * already-resolved instance on subsequent calls. A failed load is not cached,
 * so a retry after a network blip can succeed.
 */
export function loadEngine(wasmUrl: string): Promise<GoTemplateEngine> {
  if (!enginePromise) {
    enginePromise = instantiate(wasmUrl).catch(error => {
      enginePromise = undefined;
      throw error;
    });
  }
  return enginePromise;
}
