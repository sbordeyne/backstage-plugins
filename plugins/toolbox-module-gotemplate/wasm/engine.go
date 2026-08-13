// Rendering logic for the playground. Kept free of syscall/js so it can be
// exercised by `go test` on the host platform; main.go holds the js/wasm
// bridge that exposes it to the browser.
package main

import (
	"encoding/json"
	"fmt"
	"strings"
	"text/template"
	"time"

	sprig "github.com/Masterminds/sprig/v3"
	esotpl "github.com/external-secrets/external-secrets/runtime/template/v2"
	"github.com/go-sprout/sprout"
	"github.com/go-sprout/sprout/registry/checksum"
	"github.com/go-sprout/sprout/registry/conversion"
	"github.com/go-sprout/sprout/registry/crypto"
	"github.com/go-sprout/sprout/registry/encoding"
	"github.com/go-sprout/sprout/registry/env"
	"github.com/go-sprout/sprout/registry/filesystem"
	"github.com/go-sprout/sprout/registry/maps"
	"github.com/go-sprout/sprout/registry/network"
	"github.com/go-sprout/sprout/registry/numeric"
	"github.com/go-sprout/sprout/registry/random"
	"github.com/go-sprout/sprout/registry/reflect"
	"github.com/go-sprout/sprout/registry/regexp"
	"github.com/go-sprout/sprout/registry/semver"
	"github.com/go-sprout/sprout/registry/slices"
	"github.com/go-sprout/sprout/registry/std"
	sproutstrings "github.com/go-sprout/sprout/registry/strings"
	sprouttime "github.com/go-sprout/sprout/registry/time"
	"github.com/go-sprout/sprout/registry/uniqueid"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/chartutil"
	"helm.sh/helm/v3/pkg/engine"
	"sigs.k8s.io/yaml"
)

// renderRequest mirrors the TS `RenderRequest` type in src/engine/types.ts.
type renderRequest struct {
	FunctionSet string `json:"functionSet"`
	Template    string `json:"template"`
	Data        string `json:"data"`
	DataFormat  string `json:"dataFormat"` // "yaml" | "json"
	LeftDelim   string `json:"leftDelim"`
	RightDelim  string `json:"rightDelim"`
	MissingKey  string `json:"missingKey"` // "default" | "zero" | "error"

	// Helm-only knobs. They surface as .Release / .Chart inside the template.
	ReleaseName      string `json:"releaseName"`
	ReleaseNamespace string `json:"releaseNamespace"`
	ReleaseRevision  int    `json:"releaseRevision"`
	ReleaseIsUpgrade bool   `json:"releaseIsUpgrade"`
	KubeVersion      string `json:"kubeVersion"`
}

// renderResponse mirrors the TS `RenderResponse` type.
type renderResponse struct {
	Output     string `json:"output"`
	Error      string `json:"error,omitempty"`
	ErrorPhase string `json:"errorPhase,omitempty"` // "data" | "parse" | "execute"
	DurationMs int64  `json:"durationMs"`
}

const (
	setSprig  = "sprig"
	setSprout = "sprout"
	setHelm   = "helm"
	setESO    = "eso"

	// Name of the synthetic chart the helm renderer wraps the template in.
	helmChartName        = "gotemplate-playground"
	helmTemplatePath     = "templates/playground.yaml"
	helmRenderedFileName = helmChartName + "/" + helmTemplatePath
)

// sproutFuncMap builds sprout's function set from its native handler. We
// deliberately avoid sprout's `sprigin` package: that is a backwards-compat
// shim which swallows function errors to imitate sprig, which would hide real
// failures from someone using the playground to debug a sprout template.
func sproutFuncMap() template.FuncMap {
	handler := sprout.New(sprout.WithRegistries(
		std.NewRegistry(),
		uniqueid.NewRegistry(),
		semver.NewRegistry(),
		reflect.NewRegistry(),
		sprouttime.NewRegistry(),
		sproutstrings.NewRegistry(),
		random.NewRegistry(),
		checksum.NewRegistry(),
		conversion.NewRegistry(),
		numeric.NewRegistry(),
		encoding.NewRegistry(),
		regexp.NewRegistry(),
		slices.NewRegistry(),
		maps.NewRegistry(),
		crypto.NewRegistry(),
		filesystem.NewRegistry(),
		env.NewRegistry(),
		network.NewRegistry(),
	))
	return template.FuncMap(handler.Build())
}

// parseData turns the user's data pane into a Go value. YAML is a superset of
// JSON, so the YAML path handles both; we keep the distinction only so the
// error message points at the right syntax.
func parseData(raw, format string) (any, error) {
	if strings.TrimSpace(raw) == "" {
		return map[string]any{}, nil
	}
	var out any
	if format == "json" {
		if err := json.Unmarshal([]byte(raw), &out); err != nil {
			return nil, fmt.Errorf("invalid JSON: %w", err)
		}
		return out, nil
	}
	if err := yaml.Unmarshal([]byte(raw), &out); err != nil {
		return nil, fmt.Errorf("invalid YAML: %w", err)
	}
	return out, nil
}

func missingKeyOption(mode string) string {
	switch mode {
	case "zero", "error", "invalid", "default":
		return "missingkey=" + mode
	default:
		return "missingkey=default"
	}
}

func delims(req *renderRequest) (string, string) {
	l, r := req.LeftDelim, req.RightDelim
	if l == "" {
		l = "{{"
	}
	if r == "" {
		r = "}}"
	}
	return l, r
}

// renderText handles the two plain text/template sets (sprig and sprout).
func renderText(req *renderRequest, funcs template.FuncMap) *renderResponse {
	data, err := parseData(req.Data, req.DataFormat)
	if err != nil {
		return &renderResponse{Error: err.Error(), ErrorPhase: "data"}
	}

	l, r := delims(req)
	tpl, err := template.New("playground").
		Delims(l, r).
		Option(missingKeyOption(req.MissingKey)).
		Funcs(funcs).
		Parse(req.Template)
	if err != nil {
		return &renderResponse{Error: err.Error(), ErrorPhase: "parse"}
	}

	var sb strings.Builder
	if err := tpl.Execute(&sb, data); err != nil {
		// Keep whatever was written before the failure: partial output is
		// usually the fastest way to see which line blew up.
		return &renderResponse{Output: sb.String(), Error: err.Error(), ErrorPhase: "execute"}
	}
	return &renderResponse{Output: sb.String()}
}

// renderESO reproduces external-secrets-operator's templating exactly: its own
// FuncMap (which already folds in ESO's vendored sprig subset), missingkey=error
// and a flat map[string]string of secret keys as the template context.
func renderESO(req *renderRequest) *renderResponse {
	parsed, err := parseData(req.Data, req.DataFormat)
	if err != nil {
		return &renderResponse{Error: err.Error(), ErrorPhase: "data"}
	}

	// ESO hands templates the fetched secret as map[string]string.
	data := map[string]string{}
	if parsed != nil {
		m, ok := parsed.(map[string]any)
		if !ok {
			return &renderResponse{
				Error:      "external-secrets templates receive the secret as a flat key/value map, so the data pane must be a mapping (got a " + kindOf(parsed) + ")",
				ErrorPhase: "data",
			}
		}
		for k, v := range m {
			switch tv := v.(type) {
			case string:
				data[k] = tv
			default:
				// Non-string leaves are what a real secret would never hold;
				// render them as their JSON form so the template still runs.
				b, mErr := json.Marshal(tv)
				if mErr != nil {
					return &renderResponse{Error: fmt.Sprintf("cannot represent key %q as a secret value: %v", k, mErr), ErrorPhase: "data"}
				}
				data[k] = string(b)
			}
		}
	}

	l, r := delims(req)
	tpl, err := template.New("playground").
		Option("missingkey=error").
		Funcs(esotpl.FuncMap()).
		Delims(l, r).
		Parse(req.Template)
	if err != nil {
		return &renderResponse{Error: err.Error(), ErrorPhase: "parse"}
	}

	var sb strings.Builder
	if err := tpl.Execute(&sb, data); err != nil {
		return &renderResponse{Output: sb.String(), Error: err.Error(), ErrorPhase: "execute"}
	}
	return &renderResponse{Output: sb.String()}
}

// renderHelm runs the template through helm's own engine by wrapping it in a
// synthetic single-file chart. Going through engine.Render (rather than
// rebuilding a func map) is what gives us the genuine helm behaviour:
// include/tpl/required, .Release, .Capabilities and helm's error formatting.
func renderHelm(req *renderRequest) *renderResponse {
	parsed, err := parseData(req.Data, req.DataFormat)
	if err != nil {
		return &renderResponse{Error: err.Error(), ErrorPhase: "data"}
	}
	values, ok := parsed.(map[string]any)
	if !ok {
		return &renderResponse{
			Error:      "helm values must be a mapping (got a " + kindOf(parsed) + ")",
			ErrorPhase: "data",
		}
	}

	name := req.ReleaseName
	if name == "" {
		name = "playground"
	}
	namespace := req.ReleaseNamespace
	if namespace == "" {
		namespace = "default"
	}
	revision := req.ReleaseRevision
	if revision == 0 {
		revision = 1
	}

	caps := chartutil.DefaultCapabilities.Copy()
	if req.KubeVersion != "" {
		kv, kErr := chartutil.ParseKubeVersion(req.KubeVersion)
		if kErr != nil {
			return &renderResponse{Error: kErr.Error(), ErrorPhase: "data"}
		}
		caps.KubeVersion = *kv
	}

	// The chart's identity is deliberately independent of the release name, so
	// that .Chart.Name and .Release.Name behave as they do in a real chart
	// rather than always being equal.
	c := &chart.Chart{
		Metadata: &chart.Metadata{
			Name:       helmChartName,
			Version:    "0.1.0",
			APIVersion: chart.APIVersionV2,
		},
		Templates: []*chart.File{
			{Name: helmTemplatePath, Data: []byte(req.Template)},
		},
	}

	renderValues, err := chartutil.ToRenderValues(c, values, chartutil.ReleaseOptions{
		Name:      name,
		Namespace: namespace,
		Revision:  revision,
		IsUpgrade: req.ReleaseIsUpgrade,
		IsInstall: !req.ReleaseIsUpgrade,
	}, caps)
	if err != nil {
		return &renderResponse{Error: err.Error(), ErrorPhase: "data"}
	}

	out, err := engine.Render(c, renderValues)
	if err != nil {
		// helm prefixes errors with the synthetic file name; strip it so the
		// message reads as if the template were standalone.
		return &renderResponse{Error: cleanHelmError(err.Error()), ErrorPhase: "execute"}
	}
	return &renderResponse{Output: out[helmRenderedFileName]}
}

func cleanHelmError(msg string) string {
	return strings.ReplaceAll(msg, helmRenderedFileName, "template")
}

func kindOf(v any) string {
	switch v.(type) {
	case nil:
		return "null"
	case []any:
		return "list"
	case string:
		return "string"
	case bool:
		return "boolean"
	case float64, int, int64:
		return "number"
	default:
		return fmt.Sprintf("%T", v)
	}
}

func render(reqJSON string) *renderResponse {
	start := time.Now()

	var req renderRequest
	if err := json.Unmarshal([]byte(reqJSON), &req); err != nil {
		return &renderResponse{Error: "malformed request: " + err.Error(), ErrorPhase: "data"}
	}

	var resp *renderResponse
	switch req.FunctionSet {
	case setSprig:
		resp = renderText(&req, sprig.TxtFuncMap())
	case setSprout:
		resp = renderText(&req, sproutFuncMap())
	case setHelm:
		resp = renderHelm(&req)
	case setESO:
		resp = renderESO(&req)
	default:
		resp = &renderResponse{Error: fmt.Sprintf("unknown function set %q", req.FunctionSet), ErrorPhase: "data"}
	}

	resp.DurationMs = time.Since(start).Milliseconds()
	return resp
}
