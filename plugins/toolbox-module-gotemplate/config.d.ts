export interface Config {
  gotemplate?: {
    /**
     * Where the browser fetches the WebAssembly build of the Go template engine from.
     *
     * The engine is ~83MB raw (~14MB gzipped) because it embeds the real helm and
     * external-secrets code paths, and it is downloaded lazily the first time the tool is
     * opened. Defaults to the GitHub release matching this package's version; set this to a
     * self-hosted copy of `gotemplate.wasm` when your deployment cannot reach GitHub.
     *
     * Serve it with `Content-Type: application/wasm` and compression enabled.
     *
     * @visibility frontend
     */
    wasmUrl?: string;
  };
}
