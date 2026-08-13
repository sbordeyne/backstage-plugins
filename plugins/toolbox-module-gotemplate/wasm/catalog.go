// Builds the function reference the UI shows: for every function in every set,
// its category and its real signature.
//
// Signatures are read off the function values with reflection rather than being
// transcribed by hand, so they cannot drift from what the template engine will
// actually accept.

package main

import (
	"fmt"
	"reflect"
	"sort"
	"strings"
	"text/template"

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
	sproutreflect "github.com/go-sprout/sprout/registry/reflect"
	"github.com/go-sprout/sprout/registry/regexp"
	"github.com/go-sprout/sprout/registry/semver"
	"github.com/go-sprout/sprout/registry/slices"
	"github.com/go-sprout/sprout/registry/std"
	sproutstrings "github.com/go-sprout/sprout/registry/strings"
	sprouttime "github.com/go-sprout/sprout/registry/time"
	"github.com/go-sprout/sprout/registry/uniqueid"
)

// functionDoc is one row of the reference panel.
type functionDoc struct {
	Name      string `json:"name"`
	Category  string `json:"category"`
	Signature string `json:"signature"`
}

// Category labels. Kept as constants so the curated table below and the
// registry mapping cannot disagree on spelling.
const (
	catStrings   = "Strings"
	catNumbers   = "Numbers"
	catLists     = "Lists"
	catMaps      = "Maps"
	catCrypto    = "Crypto"
	catEncoding  = "Encoding"
	catDate      = "Date & time"
	catRegex     = "Regex"
	catSemver    = "Semver"
	catNetwork   = "Network"
	catPaths     = "Paths"
	catConvert   = "Conversion"
	catReflect   = "Reflection"
	catRandom    = "Random"
	catChecksum  = "Checksums"
	catIDs       = "Identifiers"
	catEnv       = "Environment"
	catFlow      = "Flow control"
	catGeneral   = "General"
	catHelm      = "Helm"
	catCertsKeys = "Certificates & keys"
	catOther     = "Other"
)

// sproutRegistries pairs each registry with the label its functions get. This
// is the authoritative categorisation: it comes from how sprout itself groups
// them, so it stays correct as sprout adds functions.
func sproutRegistries() []struct {
	label    string
	registry sprout.Registry
} {
	return []struct {
		label    string
		registry sprout.Registry
	}{
		{catStrings, sproutstrings.NewRegistry()},
		{catNumbers, numeric.NewRegistry()},
		{catLists, slices.NewRegistry()},
		{catMaps, maps.NewRegistry()},
		{catCrypto, crypto.NewRegistry()},
		{catEncoding, encoding.NewRegistry()},
		{catDate, sprouttime.NewRegistry()},
		{catRegex, regexp.NewRegistry()},
		{catSemver, semver.NewRegistry()},
		{catNetwork, network.NewRegistry()},
		{catPaths, filesystem.NewRegistry()},
		{catConvert, conversion.NewRegistry()},
		{catReflect, sproutreflect.NewRegistry()},
		{catRandom, random.NewRegistry()},
		{catChecksum, checksum.NewRegistry()},
		{catIDs, uniqueid.NewRegistry()},
		{catEnv, env.NewRegistry()},
		{catGeneral, std.NewRegistry()},
	}
}

// registryCategories maps a function name to the sprout registry it belongs to.
// Built once and reused for every set, so sprig and helm inherit the same
// grouping wherever they share a function name with sprout.
var registryCategories = buildRegistryCategories()

func buildRegistryCategories() map[string]string {
	out := map[string]string{}
	for _, entry := range sproutRegistries() {
		handler := sprout.New(sprout.WithRegistries(entry.registry))
		for name := range handler.Build() {
			// First registry to claim a name wins; the ordering above puts the
			// specific registries ahead of the catch-all `std`.
			if _, taken := out[name]; !taken {
				out[name] = entry.label
			}
		}
	}
	return out
}

// curatedCategories covers the names that sprout does not have, either because
// sprig spells them differently or because they belong to helm or ESO.
var curatedCategories = map[string]string{
	// --- sprig spellings that sprout renamed ---
	"upper": catStrings, "lower": catStrings, "title": catStrings,
	"untitle": catStrings, "swapcase": catStrings, "camelcase": catStrings,
	"kebabcase": catStrings, "snakecase": catStrings, "abbrev": catStrings,
	"abbrevboth": catStrings, "initials": catStrings, "wrap": catStrings,
	"wrapWith": catStrings, "trimall": catStrings, "nospace": catStrings,
	"plural": catStrings, "substr": catStrings, "toString": catStrings,
	"quote": catStrings, "squote": catStrings, "indent": catStrings,
	"nindent": catStrings, "trunc": catStrings, "repeat": catStrings,
	"shuffle": catStrings, "seq": catStrings, "cat": catStrings,
	"printf": catStrings, "print": catStrings, "println": catStrings,

	"b64enc": catEncoding, "b64dec": catEncoding,
	"b32enc": catEncoding, "b32dec": catEncoding,
	"toJson": catEncoding, "toPrettyJson": catEncoding, "toRawJson": catEncoding,
	"fromJson": catEncoding, "fromJsonArray": catEncoding,
	"mustToJson": catEncoding, "mustToPrettyJson": catEncoding,
	"mustToRawJson": catEncoding, "mustFromJson": catEncoding,
	"mustFromJsonArray": catEncoding,

	"atoi": catConvert, "int": catConvert, "int64": catConvert,
	"float64": catConvert, "toDecimal": catConvert, "toStrings": catConvert,

	"biggest": catNumbers, "untilStep": catNumbers, "until": catNumbers,

	"ago": catDate, "date": catDate, "dateInZone": catDate,
	"date_in_zone": catDate, "dateModify": catDate, "date_modify": catDate,
	"must_date_modify": catDate, "mustDateModify": catDate,
	"htmlDate": catDate, "htmlDateInZone": catDate, "toDate": catDate,
	"mustToDate": catDate, "now": catDate, "unixEpoch": catDate,
	"duration": catDate, "durationRound": catDate,

	"push": catLists, "mustPush": catLists, "tuple": catLists,
	"list": catLists, "dict": catMaps, "dig": catMaps,

	"base": catPaths, "dir": catPaths, "ext": catPaths, "clean": catPaths,
	"isAbs": catPaths, "osBase": catPaths, "osDir": catPaths,
	"osExt": catPaths, "osClean": catPaths, "osIsAbs": catPaths,

	"env": catEnv, "expandenv": catEnv,

	"getHostByName": catNetwork, "urlParse": catNetwork,
	"urlJoin": catNetwork, "urlquery": catNetwork,

	"sha512sum": catChecksum, "sha256sum": catChecksum,
	"sha1sum": catChecksum, "adler32sum": catChecksum,

	"fail": catFlow, "required": catFlow, "default": catFlow,
	"empty": catFlow, "coalesce": catFlow, "ternary": catFlow,
	"and": catFlow, "or": catFlow, "not": catFlow, "eq": catFlow,
	"ne": catFlow, "lt": catFlow, "le": catFlow, "gt": catFlow, "ge": catFlow,
	"if": catFlow, "else": catFlow,

	"hexdec": catEncoding, "hexenc": catEncoding,
}

// helmCategories applies only to the helm set. These names are filed under Helm
// because helm is where they come from — but sprout and ESO define their own
// toYaml/fromYaml, so this table must not leak into those sets.
var helmCategories = map[string]string{
	"include": catHelm, "tpl": catHelm, "lookup": catHelm,
	"toYaml": catHelm, "toYamlPretty": catHelm, "fromYaml": catHelm,
	"fromYamlArray": catHelm, "toToml": catHelm, "fromToml": catHelm,
	"required": catHelm,
}

// esoCategories applies only to the external-secrets set.
var esoCategories = map[string]string{
	"pkcs12key": catCertsKeys, "pkcs12keyPass": catCertsKeys,
	"pkcs12cert": catCertsKeys, "pkcs12certPass": catCertsKeys,
	"pemToPkcs12": catCertsKeys, "pemToPkcs12Pass": catCertsKeys,
	"fullPemToPkcs12": catCertsKeys, "fullPemToPkcs12Pass": catCertsKeys,
	"pemTruststoreToPKCS12": catCertsKeys, "pemTruststoreToPKCS12Pass": catCertsKeys,
	"filterPEM": catCertsKeys, "filterCertChain": catCertsKeys,
	"certSANs": catCertsKeys, "jwkPublicKeyPem": catCertsKeys,
	"jwkPrivateKeyPem": catCertsKeys, "rsaDecrypt": catCertsKeys,
	// ESO ships these itself rather than inheriting helm's.
	"toYaml": catEncoding, "fromYaml": catEncoding,
}

// setCategories returns the set-specific overrides, if any.
func setCategories(set string) map[string]string {
	switch set {
	case setHelm:
		return helmCategories
	case setESO:
		return esoCategories
	}
	return nil
}

// categoryOf resolves a function name to its group. Curated entries win over the
// registry mapping so that helm's `toYaml` is filed under Helm rather than
// wherever a same-named sprout function happens to live.
func categoryOf(set, name string) string {
	if overrides := setCategories(set); overrides != nil {
		if c, ok := overrides[name]; ok {
			return c
		}
	}
	if c, ok := curatedCategories[name]; ok {
		return c
	}
	if c, ok := registryCategories[name]; ok {
		return c
	}
	// `mustX` is the error-returning twin of `X` and belongs beside it.
	if strings.HasPrefix(name, "must") && len(name) > 4 {
		bare := strings.ToLower(name[4:5]) + name[5:]
		if overrides := setCategories(set); overrides != nil {
			if c, ok := overrides[bare]; ok {
				return c
			}
		}
		if c, ok := curatedCategories[bare]; ok {
			return c
		}
		if c, ok := registryCategories[bare]; ok {
			return c
		}
	}
	return catOther
}

// signatureOf renders a function's real Go signature, e.g.
// `trunc(int, string) string`. Falls back to the bare name for values that are
// not functions at all.
func signatureOf(name string, fn any) string {
	if fn == nil {
		return name
	}
	t := reflect.TypeOf(fn)
	if t == nil || t.Kind() != reflect.Func {
		return name
	}

	params := make([]string, 0, t.NumIn())
	for i := 0; i < t.NumIn(); i++ {
		p := typeName(t.In(i))
		if t.IsVariadic() && i == t.NumIn()-1 {
			// The final parameter of a variadic function is a slice; show it in
			// the form templates actually use.
			p = "..." + typeName(t.In(i).Elem())
		}
		params = append(params, p)
	}

	results := make([]string, 0, t.NumOut())
	for i := 0; i < t.NumOut(); i++ {
		results = append(results, typeName(t.Out(i)))
	}

	sig := name + "(" + strings.Join(params, ", ") + ")"
	switch len(results) {
	case 0:
	case 1:
		sig += " " + results[0]
	default:
		sig += " (" + strings.Join(results, ", ") + ")"
	}
	return sig
}

func typeName(t reflect.Type) string {
	if t == nil {
		return "any"
	}
	switch t.Kind() {
	case reflect.Interface:
		if t.NumMethod() == 0 {
			return "any"
		}
	case reflect.Slice:
		return "[]" + typeName(t.Elem())
	case reflect.Map:
		return "map[" + typeName(t.Key()) + "]" + typeName(t.Elem())
	case reflect.Ptr:
		return "*" + typeName(t.Elem())
	}
	if name := t.String(); name != "" {
		return name
	}
	return fmt.Sprintf("%v", t)
}

func docsFor(set string, funcs template.FuncMap) []functionDoc {
	out := make([]functionDoc, 0, len(funcs))
	for name, fn := range funcs {
		out = append(out, functionDoc{
			Name:      name,
			Category:  categoryOf(set, name),
			Signature: signatureOf(name, fn),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// helmFuncMap reconstructs the function set helm exposes. Helm's own map is
// unexported, so this mirrors how helm composes it: sprig, minus the functions
// helm deliberately drops, plus helm's additions. Rendering still goes through
// helm's real engine — this only drives the reference panel.
func helmFuncMap() template.FuncMap {
	funcs := template.FuncMap{}
	for k, v := range sprig.TxtFuncMap() {
		funcs[k] = v
	}
	for _, removed := range []string{"env", "expandenv"} {
		delete(funcs, removed)
	}
	// Signatures for helm's additions, expressed as the shapes helm documents.
	funcs["include"] = func(string, any) string { return "" }
	funcs["tpl"] = func(string, any) any { return nil }
	funcs["required"] = func(string, any) (any, error) { return nil, nil }
	funcs["fail"] = func(string) (string, error) { return "", nil }
	funcs["lookup"] = func(string, string, string, string) (map[string]any, error) {
		return nil, nil
	}
	funcs["toYaml"] = func(any) string { return "" }
	funcs["toYamlPretty"] = func(any) string { return "" }
	funcs["fromYaml"] = func(string) map[string]any { return nil }
	funcs["fromYamlArray"] = func(string) []any { return nil }
	funcs["toToml"] = func(any) string { return "" }
	funcs["fromToml"] = func(string) map[string]any { return nil }
	return funcs
}

func functionCatalog() map[string][]functionDoc {
	return map[string][]functionDoc{
		setSprig:  docsFor(setSprig, sprig.TxtFuncMap()),
		setSprout: docsFor(setSprout, sproutFuncMap()),
		setHelm:   docsFor(setHelm, helmFuncMap()),
		setESO:    docsFor(setESO, esotpl.FuncMap()),
	}
}
