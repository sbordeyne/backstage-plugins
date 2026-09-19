/**
 * The normalized schema model, shared by the ingest worker that produces it and
 * the page that renders it.
 *
 * A resource's schema is stored fully expanded: no `$ref` survives normalization,
 * so a client renders a tree without resolving anything. Kubernetes is the only
 * source whose upstream spec uses refs at all — every CRD already ships a
 * materialized tree.
 */

/** Group / version / kind: the identity of an API resource. */
export interface Gvk {
  /** Empty string for the core Kubernetes group. */
  group: string;
  /** Just the version, e.g. `v1` or `v1beta1`. */
  version: string;
  kind: string;
}

export type KubespecScope = 'Cluster' | 'Namespaced';

/**
 * One property within a schema.
 *
 * Deliberately carries no `path`: a path is the concatenation of the names above
 * it, and at depth 10 the paths outweigh everything else in the payload. Clients
 * derive it while flattening.
 */
export interface KubespecProperty {
  name: string;
  /**
   * The base type, without any array suffix — `string`, `object`, or a named type
   * such as `PodSpec`. Rendering `PodSpec[]` is the client's job, from `isArray`.
   */
  type: string;
  isArray: boolean;
  required: boolean;
  description: string;
  /** Allowed values, when the schema constrains them. */
  enumValues?: string[];
  /** JSON-encoded, because a default can be any JSON value. */
  defaultValue?: string;
  /** OpenAPI `format`, e.g. `int64`, `date-time`, `byte`. */
  format?: string;
  /** `x-kubernetes-preserve-unknown-fields`: the schema below here is open. */
  preserveUnknownFields?: boolean;
  /**
   * Set when this property's type repeats one already on the path to it, e.g.
   * `JSONSchemaProps` inside a CustomResourceDefinition. Expansion stops here,
   * and the value names the ancestor path the type came from.
   */
  recursiveOf?: string;
  /** Absent on a leaf. */
  children?: KubespecProperty[];
}

export interface KubespecResourceDefinition {
  description: string;
  properties: KubespecProperty[];
}
