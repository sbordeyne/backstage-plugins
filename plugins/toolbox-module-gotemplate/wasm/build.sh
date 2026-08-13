#!/usr/bin/env bash
# Builds the Go template engine to WebAssembly and vendors the Go runtime shim
# that loads it.
#
# The output is intentionally not committed: it is ~83MB uncompressed. Run this
# before packing/publishing (the prepack script does) or before `yarn start`.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
pkg_root="$(dirname "$here")"
out_dir="$pkg_root/static"

if ! command -v go >/dev/null 2>&1; then
  echo "error: the Go toolchain is required to build the template engine." >&2
  echo "       install Go (https://go.dev/dl/), then re-run 'yarn build:wasm'." >&2
  exit 1
fi

mkdir -p "$out_dir"

echo "==> building gotemplate.wasm (this pulls the helm and external-secrets module trees; first run is slow)"
cd "$here"
GOOS=js GOARCH=wasm go build -ldflags="-s -w" -trimpath -o "$out_dir/gotemplate.wasm" .

# wasm_exec.js is the loader shim shipped with the Go distribution and must be
# version-matched to the compiler that produced the module, so we copy it out of
# GOROOT rather than vendoring a snapshot by hand.
goroot="$(go env GOROOT)"
if [[ -f "$goroot/lib/wasm/wasm_exec.js" ]]; then
  shim="$goroot/lib/wasm/wasm_exec.js"
elif [[ -f "$goroot/misc/wasm/wasm_exec.js" ]]; then
  shim="$goroot/misc/wasm/wasm_exec.js"
else
  echo "error: could not find wasm_exec.js under $goroot" >&2
  exit 1
fi

# The committed copy under src/ is what gets bundled; refresh it so it can never
# drift from the compiler that produced the module next to it.
vendored="$pkg_root/src/engine/wasm_exec.js"
# The vendored copy is the pristine shim plus an appended ES export. Compare
# only the pristine part, so the export does not read as constant drift.
if ! head -n "$(wc -l < "$shim")" "$vendored" 2>/dev/null | cmp -s "$shim" -; then
  echo "==> refreshing vendored wasm_exec.js (Go toolchain changed) — commit this"
  cp "$shim" "$vendored"
  chmod +w "$vendored"
  cat >> "$vendored" <<'SHIM_EXPORT'

// ---------------------------------------------------------------------------
// Appended by wasm/build.sh, not part of the Go distribution.
//
// Everything above is a side-effect-only IIFE that assigns `globalThis.Go`. A
// bare `import './wasm_exec.js'` binds nothing, so any bundler is free to drop
// it — and one that respects our `sideEffects: false` will. Re-exporting the
// class gives the import a used binding, which keeps it in the bundle.
// ---------------------------------------------------------------------------
export const Go = globalThis.Go;
SHIM_EXPORT
fi

echo "==> wrote:"
ls -lh "$out_dir/gotemplate.wasm" | sed 's/^/    /'
echo "==> transfer size (gzip, what a CDN or a compressing server sends):"
echo "    $(gzip -9 -c "$out_dir/gotemplate.wasm" | wc -c | tr -d ' ') bytes"
