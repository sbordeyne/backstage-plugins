package main

import (
	"encoding/json"
	"strings"
	"testing"
)

func renderJSON(t *testing.T, req renderRequest) *renderResponse {
	t.Helper()
	b, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	return render(string(b))
}

func TestSprigUsesSprigNames(t *testing.T) {
	got := renderJSON(t, renderRequest{
		FunctionSet: setSprig,
		Template:    `{{ .name | upper }}-{{ b64enc "hi" }}-{{ add 3 4 }}`,
		Data:        "name: bob",
		DataFormat:  "yaml",
	})
	if got.Error != "" {
		t.Fatalf("unexpected error: %s", got.Error)
	}
	if want := "BOB-aGk=-7"; got.Output != want {
		t.Errorf("output = %q, want %q", got.Output, want)
	}
}

// Sprout renamed most of sprig's functions. Pinning that difference here is
// what stops us from silently swapping in sprout's sprig-compatibility shim,
// which would make the two sets indistinguishable.
func TestSproutUsesItsOwnNames(t *testing.T) {
	got := renderJSON(t, renderRequest{
		FunctionSet: setSprout,
		Template:    `{{ .name | toUpper }}-{{ base64Encode "hi" }}`,
		Data:        "name: bob",
		DataFormat:  "yaml",
	})
	if got.Error != "" {
		t.Fatalf("unexpected error: %s", got.Error)
	}
	if want := "BOB-aGk="; got.Output != want {
		t.Errorf("output = %q, want %q", got.Output, want)
	}

	// sprig's spelling must NOT resolve under sprout.
	sprigStyle := renderJSON(t, renderRequest{
		FunctionSet: setSprout,
		Template:    `{{ .name | upper }}`,
		Data:        "name: bob",
		DataFormat:  "yaml",
	})
	if sprigStyle.Error == "" {
		t.Error("expected sprout to reject sprig's `upper`, but it rendered")
	}
}

func TestHelmProvidesReleaseAndIncludeAndToYaml(t *testing.T) {
	got := renderJSON(t, renderRequest{
		FunctionSet:      setHelm,
		Template:         "{{- define \"l\" }}from-include{{ end -}}\nrel: {{ .Release.Name }}/{{ .Release.Namespace }}\ninc: {{ include \"l\" . }}\nimg: {{ .Values.image | quote }}\nyaml:\n{{ toYaml .Values.env | indent 2 }}",
		Data:             "image: acme/api:1\nenv:\n  LOG: debug",
		DataFormat:       "yaml",
		ReleaseName:      "rel1",
		ReleaseNamespace: "team-a",
	})
	if got.Error != "" {
		t.Fatalf("unexpected error: %s", got.Error)
	}
	for _, want := range []string{
		"rel: rel1/team-a",
		"inc: from-include",
		`img: "acme/api:1"`,
		"LOG: debug",
	} {
		if !strings.Contains(got.Output, want) {
			t.Errorf("output missing %q:\n%s", want, got.Output)
		}
	}
}

func TestHelmRequiredFailsWithItsOwnMessage(t *testing.T) {
	got := renderJSON(t, renderRequest{
		FunctionSet: setHelm,
		Template:    `{{ required "an image is required" .Values.image }}`,
		Data:        "other: 1",
		DataFormat:  "yaml",
	})
	if got.Error == "" {
		t.Fatal("expected required to fail")
	}
	if !strings.Contains(got.Error, "an image is required") {
		t.Errorf("error = %q, want it to carry helm's message", got.Error)
	}
	// The synthetic chart filename is an implementation detail and must not leak.
	if strings.Contains(got.Error, "playground.yaml") {
		t.Errorf("error leaks the synthetic chart path: %q", got.Error)
	}
}

// .Chart.Name must not track the release name, otherwise a chart-vs-release
// mix-up in a real chart would render fine here.
func TestHelmChartNameIsIndependentOfReleaseName(t *testing.T) {
	got := renderJSON(t, renderRequest{
		FunctionSet: setHelm,
		Template:    `{{ .Chart.Name }}|{{ .Release.Name }}|{{ .Chart.Version }}`,
		Data:        "{}",
		DataFormat:  "yaml",
		ReleaseName: "my-release",
	})
	if got.Error != "" {
		t.Fatalf("unexpected error: %s", got.Error)
	}
	parts := strings.Split(got.Output, "|")
	if parts[0] == parts[1] {
		t.Errorf(".Chart.Name and .Release.Name are both %q; they must differ", parts[0])
	}
	if parts[1] != "my-release" {
		t.Errorf(".Release.Name = %q, want my-release", parts[1])
	}
}

func TestHelmKubeVersionIsConfigurable(t *testing.T) {
	got := renderJSON(t, renderRequest{
		FunctionSet: setHelm,
		Template:    `{{ .Capabilities.KubeVersion.Version }}`,
		Data:        "{}",
		DataFormat:  "yaml",
		KubeVersion: "v1.30.2",
	})
	if got.Error != "" {
		t.Fatalf("unexpected error: %s", got.Error)
	}
	if got.Output != "v1.30.2" {
		t.Errorf("output = %q, want v1.30.2", got.Output)
	}
}

func TestESOExposesSecretAsFlatMap(t *testing.T) {
	got := renderJSON(t, renderRequest{
		FunctionSet: setESO,
		Template:    `{{ .username }}:{{ .password | b64enc }}`,
		Data:        "username: svc\npassword: pw",
		DataFormat:  "yaml",
	})
	if got.Error != "" {
		t.Fatalf("unexpected error: %s", got.Error)
	}
	if want := "svc:cHc="; got.Output != want {
		t.Errorf("output = %q, want %q", got.Output, want)
	}
}

// The operator hardcodes missingkey=error, so the playground must too —
// otherwise a template that would fail in-cluster looks fine here.
func TestESOAlwaysErrorsOnMissingKey(t *testing.T) {
	got := renderJSON(t, renderRequest{
		FunctionSet: setESO,
		Template:    `{{ .nope }}`,
		Data:        "username: svc",
		DataFormat:  "yaml",
		MissingKey:  "default", // explicitly relaxed; must be ignored
	})
	if got.Error == "" {
		t.Fatal("expected a missing key to be an error under ESO")
	}
}

func TestESOShipsItsOwnHelpers(t *testing.T) {
	catalog := names(functionCatalog())
	for _, fn := range []string{"pkcs12key", "jwkPublicKeyPem", "filterPEM", "rsaDecrypt"} {
		if !contains(catalog[setESO], fn) {
			t.Errorf("ESO function set is missing %q", fn)
		}
	}
}

func TestESORejectsNonMappingData(t *testing.T) {
	got := renderJSON(t, renderRequest{
		FunctionSet: setESO,
		Template:    `{{ . }}`,
		Data:        "- a\n- b",
		DataFormat:  "yaml",
	})
	if got.ErrorPhase != "data" {
		t.Errorf("errorPhase = %q, want data (got error %q)", got.ErrorPhase, got.Error)
	}
}

func TestCustomDelimiters(t *testing.T) {
	got := renderJSON(t, renderRequest{
		FunctionSet: setSprig,
		Template:    `[[ .x ]] and {{ not-a-template }}`,
		Data:        "x: hi",
		DataFormat:  "yaml",
		LeftDelim:   "[[",
		RightDelim:  "]]",
	})
	if got.Error != "" {
		t.Fatalf("unexpected error: %s", got.Error)
	}
	if want := "hi and {{ not-a-template }}"; got.Output != want {
		t.Errorf("output = %q, want %q", got.Output, want)
	}
}

func TestMissingKeyModes(t *testing.T) {
	for _, tc := range []struct {
		mode      string
		wantError bool
	}{
		{"default", false},
		{"zero", false},
		{"error", true},
	} {
		got := renderJSON(t, renderRequest{
			FunctionSet: setSprig,
			Template:    `{{ .nope }}`,
			Data:        "x: 1",
			DataFormat:  "yaml",
			MissingKey:  tc.mode,
		})
		if tc.wantError && got.Error == "" {
			t.Errorf("missingkey=%s: expected an error", tc.mode)
		}
		if !tc.wantError && got.Error != "" {
			t.Errorf("missingkey=%s: unexpected error %q", tc.mode, got.Error)
		}
	}
}

func TestErrorPhasesAreDistinguished(t *testing.T) {
	for _, tc := range []struct {
		name      string
		req       renderRequest
		wantPhase string
	}{
		{
			name:      "bad data",
			req:       renderRequest{FunctionSet: setSprig, Template: `ok`, Data: "a: [unclosed", DataFormat: "yaml"},
			wantPhase: "data",
		},
		{
			name:      "bad template",
			req:       renderRequest{FunctionSet: setSprig, Template: `{{ .broken`, DataFormat: "yaml"},
			wantPhase: "parse",
		},
		{
			name:      "runtime failure",
			req:       renderRequest{FunctionSet: setSprig, Template: `{{ fail "boom" }}`, DataFormat: "yaml"},
			wantPhase: "execute",
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := renderJSON(t, tc.req)
			if got.ErrorPhase != tc.wantPhase {
				t.Errorf("errorPhase = %q, want %q (error %q)", got.ErrorPhase, tc.wantPhase, got.Error)
			}
		})
	}
}

// A failing template still returns whatever was emitted before the failure,
// which is usually the fastest way to locate the offending line.
func TestPartialOutputIsKeptOnExecuteError(t *testing.T) {
	got := renderJSON(t, renderRequest{
		FunctionSet: setSprig,
		Template:    "line one\n{{ fail \"boom\" }}",
		DataFormat:  "yaml",
	})
	if got.Error == "" {
		t.Fatal("expected an execute error")
	}
	if !strings.Contains(got.Output, "line one") {
		t.Errorf("partial output was discarded: %q", got.Output)
	}
}

func TestEmptyDataIsAnEmptyMapNotAnError(t *testing.T) {
	got := renderJSON(t, renderRequest{
		FunctionSet: setSprig,
		Template:    `{{ len . }}`,
		Data:        "   \n",
		DataFormat:  "yaml",
	})
	if got.Error != "" {
		t.Fatalf("unexpected error: %s", got.Error)
	}
	if got.Output != "0" {
		t.Errorf("output = %q, want 0", got.Output)
	}
}

func TestJSONDataFormat(t *testing.T) {
	got := renderJSON(t, renderRequest{
		FunctionSet: setSprig,
		Template:    `{{ .name }}`,
		Data:        `{"name":"from-json"}`,
		DataFormat:  "json",
	})
	if got.Error != "" {
		t.Fatalf("unexpected error: %s", got.Error)
	}
	if got.Output != "from-json" {
		t.Errorf("output = %q", got.Output)
	}
}

func TestUnknownFunctionSetIsReported(t *testing.T) {
	got := renderJSON(t, renderRequest{FunctionSet: "jinja", Template: "x"})
	if got.Error == "" || !strings.Contains(got.Error, "jinja") {
		t.Errorf("error = %q, want it to name the unknown set", got.Error)
	}
}

func TestFunctionCatalogCoversEverySet(t *testing.T) {
	catalog := names(functionCatalog())
	for _, set := range []string{setSprig, setSprout, setHelm, setESO} {
		if len(catalog[set]) == 0 {
			t.Errorf("function catalog for %q is empty", set)
		}
	}
	// helm strips the environment-reading functions sprig provides.
	for _, banned := range []string{"env", "expandenv"} {
		if contains(catalog[setHelm], banned) {
			t.Errorf("helm catalog should not advertise %q", banned)
		}
	}
	for _, want := range []string{"include", "tpl", "required", "toYaml"} {
		if !contains(catalog[setHelm], want) {
			t.Errorf("helm catalog is missing %q", want)
		}
	}
}

// names flattens the catalog to plain name lists for the assertions below.
func names(catalog map[string][]functionDoc) map[string][]string {
	out := map[string][]string{}
	for set, docs := range catalog {
		for _, d := range docs {
			out[set] = append(out[set], d.Name)
		}
	}
	return out
}

func contains(haystack []string, needle string) bool {
	for _, v := range haystack {
		if v == needle {
			return true
		}
	}
	return false
}

// toYaml exists in three sets but comes from a different place in each, so it
// must not be filed under Helm everywhere.
func TestCategoriesAreResolvedPerSet(t *testing.T) {
	catalog := functionCatalog()
	categoryOfIn := func(set, name string) string {
		for _, d := range catalog[set] {
			if d.Name == name {
				return d.Category
			}
		}
		return ""
	}

	if got := categoryOfIn(setHelm, "toYaml"); got != catHelm {
		t.Errorf("helm toYaml category = %q, want %q", got, catHelm)
	}
	if got := categoryOfIn(setESO, "toYaml"); got == catHelm {
		t.Errorf("ESO toYaml is filed under Helm, but ESO defines its own")
	}
	if got := categoryOfIn(setSprout, "toYaml"); got == catHelm {
		t.Errorf("sprout toYaml is filed under Helm, but sprout defines its own")
	}
	if got := categoryOfIn(setESO, "pkcs12key"); got != catCertsKeys {
		t.Errorf("ESO pkcs12key category = %q, want %q", got, catCertsKeys)
	}
}

// Every function should land somewhere meaningful; a growing "Other" bucket
// means the categorisation has drifted behind an upstream bump.
func TestCategorisationLeavesAlmostNothingUncategorised(t *testing.T) {
	for set, docs := range functionCatalog() {
		var other []string
		for _, d := range docs {
			if d.Category == catOther {
				other = append(other, d.Name)
			}
		}
		if len(other) > 0 {
			t.Errorf("%s has uncategorised functions: %v", set, other)
		}
	}
}

// Signatures come from reflection, so they should be real types rather than
// bare names.
func TestSignaturesAreRendered(t *testing.T) {
	catalog := functionCatalog()
	for _, d := range catalog[setSprig] {
		if !strings.Contains(d.Signature, "(") {
			t.Errorf("%s has no rendered signature: %q", d.Name, d.Signature)
		}
	}
	for _, d := range catalog[setSprig] {
		if d.Name == "trunc" && !strings.Contains(d.Signature, "int") {
			t.Errorf("trunc signature looks wrong: %q", d.Signature)
		}
	}
}
