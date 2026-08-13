/**
 * The four function sets the playground can render with. Each one is backed by
 * the real upstream Go library rather than a reimplementation.
 */
export type FunctionSet = 'sprig' | 'sprout' | 'helm' | 'eso';

export const FUNCTION_SETS: FunctionSet[] = ['sprig', 'sprout', 'helm', 'eso'];

export type DataFormat = 'yaml' | 'json';

/** How `text/template` should treat a map key that is not present. */
export type MissingKeyMode = 'default' | 'zero' | 'error';

/** Which stage of rendering failed. */
export type ErrorPhase = 'data' | 'parse' | 'execute';

export interface RenderRequest {
  functionSet: FunctionSet;
  template: string;
  data: string;
  dataFormat: DataFormat;
  leftDelim?: string;
  rightDelim?: string;
  missingKey?: MissingKeyMode;

  /**
   * Helm-only. These surface inside the template as `.Release` / `.Capabilities`
   * and are ignored by the other function sets.
   */
  releaseName?: string;
  releaseNamespace?: string;
  releaseRevision?: number;
  releaseIsUpgrade?: boolean;
  kubeVersion?: string;
}

export interface RenderResponse {
  output: string;
  error?: string;
  errorPhase?: ErrorPhase;
  durationMs: number;
}

/**
 * One entry of the function reference. Signatures are read off the real Go
 * function values by reflection in the engine, so they cannot drift from what
 * the template will actually accept.
 */
export interface FunctionDoc {
  name: string;
  category: string;
  /** e.g. `trunc(int, string) string` */
  signature: string;
}

/** Functions available per set, used for the reference panel. */
export type FunctionCatalog = Record<FunctionSet, FunctionDoc[]>;

/** Where each set's functions are documented upstream. */
export const FUNCTION_SET_DOC_URLS: Record<FunctionSet, string> = {
  sprig: 'https://masterminds.github.io/sprig/',
  sprout: 'https://docs.atom.codes/sprout',
  helm: 'https://helm.sh/docs/chart_template_guide/function_list/',
  eso: 'https://external-secrets.io/latest/guides/templating/',
};

export interface GoTemplateEngine {
  render(request: RenderRequest): RenderResponse;
  functions(): FunctionCatalog;
}

export const FUNCTION_SET_LABELS: Record<FunctionSet, string> = {
  sprig: 'Sprig',
  sprout: 'Sprout',
  helm: 'Helm',
  eso: 'External Secrets',
};

export const FUNCTION_SET_DESCRIPTIONS: Record<FunctionSet, string> = {
  sprig: 'Masterminds/sprig v3 on top of Go text/template. The set most tools mean by "sprig functions".',
  sprout:
    "go-sprout/sprout v1, sprig's successor. Note it renames functions: upper is toUpper, b64enc is base64Encode.",
  helm: "Helm's own template engine: sprig plus include, tpl, required, toYaml, and the .Release / .Capabilities context.",
  eso: "external-secrets-operator's template engine: its PKCS12/JWK/PEM helpers, with the secret exposed as a flat key/value map.",
};
