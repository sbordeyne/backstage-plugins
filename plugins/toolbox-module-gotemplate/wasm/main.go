//go:build js && wasm

// Command gotemplate-playground exposes Go's text/template engine to the
// browser, wired up to the four function sets the Backstage toolbox tool
// offers: sprig, sprout, helm and external-secrets-operator.
//
// Each set is executed through the *real* upstream library rather than a
// reimplementation, so what the playground prints is what the corresponding
// tool would print.
package main

import (
	"encoding/json"
	"syscall/js"
)

func main() {
	js.Global().Set("__gotemplateRender", js.FuncOf(func(_ js.Value, args []js.Value) any {
		if len(args) != 1 {
			return `{"error":"render expects exactly one argument","errorPhase":"data"}`
		}
		b, err := json.Marshal(render(args[0].String()))
		if err != nil {
			return `{"error":"failed to encode response","errorPhase":"execute"}`
		}
		return string(b)
	}))

	js.Global().Set("__gotemplateFunctions", js.FuncOf(func(_ js.Value, _ []js.Value) any {
		b, err := json.Marshal(functionCatalog())
		if err != nil {
			return "{}"
		}
		return string(b)
	}))

	// Signal readiness, then park forever: exiting main would tear down the
	// Go runtime and invalidate the callbacks we just exported.
	if ready := js.Global().Get("__gotemplateReady"); ready.Type() == js.TypeFunction {
		ready.Invoke()
	}
	select {}
}
