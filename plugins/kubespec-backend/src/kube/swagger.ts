import type { KubespecProperty, KubespecScope } from '@sbordeyne/kubespec-common';

import { ExpansionBudget, ExpansionLimits, NormalizedResource, apiVersionFull } from './model';

interface SwaggerGvk {
  group: string;
  version: string;
  kind: string;
}

interface SwaggerOperation {
  'x-kubernetes-action'?: string;
  'x-kubernetes-group-version-kind'?: SwaggerGvk;
}

interface SwaggerRef {
  type?: string;
  format?: string;
  $ref?: string;
}

interface SwaggerProperty extends SwaggerRef {
  description?: string;
  items?: SwaggerRef;
  additionalProperties?: SwaggerRef;
  enum?: unknown[];
  default?: unknown;
}

interface SwaggerDefinition {
  description?: string;
  type?: string;
  format?: string;
  properties?: Record<string, SwaggerProperty>;
  required?: string[];
  'x-kubernetes-group-version-kind'?: SwaggerGvk[];
}

export interface SwaggerDocument {
  paths?: Record<string, Record<string, unknown>>;
  definitions?: Record<string, SwaggerDefinition>;
}

export interface NormalizeSwaggerOptions {
  limits: ExpansionLimits;
  /** Kind -> category. A kind absent from the map falls into `defaultCategory`. */
  categoryByKind: Record<string, string>;
  defaultCategory: string;
}

export interface NormalizeSwaggerResult {
  resources: NormalizedResource[];
  warnings: string[];
}

const REF_PREFIX = '#/definitions/';
const MAX_ENUM_VALUES = 50;

/**
 * Normalizes a Kubernetes OpenAPI v2 (swagger) document into browsable resources.
 *
 * A GVK counts as browsable when the API serves a `list` operation for it, which
 * is how the upstream docs decide too.
 */
export function normalizeSwagger(document: SwaggerDocument, options: NormalizeSwaggerOptions): NormalizeSwaggerResult {
  const warnings: string[] = [];
  const listed = collectListableGvks(document);
  const definitionKeys = indexDefinitionsByGvk(document);

  const resources: NormalizedResource[] = [];

  for (const [key, entry] of listed) {
    const definitionKey = definitionKeys.get(key);
    if (!definitionKey) {
      // A kind the API lists but publishes no schema for. Rare, and there is
      // nothing to render, so it is dropped with a note rather than a failure.
      warnings.push(`No schema definition for ${key}`);
      continue;
    }

    const budget = new ExpansionBudget(options.limits);
    const root = document.definitions?.[definitionKey];
    const properties = expandDefinition(document, definitionKey, budget, 0, '', new Map());

    resources.push({
      group: entry.gvk.group,
      version: entry.gvk.version,
      kind: entry.gvk.kind,
      apiVersionFull: apiVersionFull(entry.gvk.group, entry.gvk.version),
      category: options.categoryByKind[entry.gvk.kind] ?? options.defaultCategory,
      scope: scopeOf(entry.paths),
      definition: { description: root?.description ?? '', properties },
      propertyCount: budget.count,
      treeDepth: budget.depth,
      truncated: budget.truncated,
    });
  }

  return { resources, warnings };
}

interface ListedGvk {
  gvk: SwaggerGvk;
  /** Every request path that lists this GVK. */
  paths: string[];
}

/**
 * Collects listable GVKs and the paths they are served on, in one pass.
 *
 * The paths are what determine scope. kubespec.dev instead rebuilds a candidate
 * path from `pluralize(kind.toLowerCase())` and tests whether the spec contains
 * it — so any kind whose plural the library gets wrong is silently reported as
 * cluster-scoped.
 */
function collectListableGvks(document: SwaggerDocument): Map<string, ListedGvk> {
  const listed = new Map<string, ListedGvk>();

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const candidate of Object.values(pathItem)) {
      // A path item also holds non-operation members such as `parameters`.
      if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
        continue;
      }
      const operation = candidate as SwaggerOperation;
      if (operation['x-kubernetes-action'] !== 'list') {
        continue;
      }
      const gvk = operation['x-kubernetes-group-version-kind'];
      if (!gvk) {
        continue;
      }

      const key = gvkKey(gvk);
      const existing = listed.get(key);
      if (existing) {
        existing.paths.push(path);
      } else {
        listed.set(key, { gvk, paths: [path] });
      }
    }
  }

  return listed;
}

function scopeOf(paths: readonly string[]): KubespecScope {
  return paths.some(path => path.includes('/namespaces/{namespace}/')) ? 'Namespaced' : 'Cluster';
}

/** One pass over the definitions, rather than a scan per GVK. */
function indexDefinitionsByGvk(document: SwaggerDocument): Map<string, string> {
  const index = new Map<string, string>();

  for (const [key, definition] of Object.entries(document.definitions ?? {})) {
    for (const gvk of definition['x-kubernetes-group-version-kind'] ?? []) {
      const gvkId = gvkKey(gvk);
      // Several definitions can claim one GVK across deprecated aliases; the
      // first wins, and definitions are iterated in a stable order.
      if (!index.has(gvkId)) {
        index.set(gvkId, key);
      }
    }
  }

  return index;
}

function gvkKey(gvk: SwaggerGvk): string {
  return `${gvk.group}/${gvk.version}/${gvk.kind}`;
}

/**
 * Expands one definition's properties, resolving `$ref` as it goes.
 *
 * `visited` maps a definition key to the path at which it was entered, and is
 * scoped to the current branch: a type reused in two branches is expanded in
 * both, while a type that contains itself stops and is flagged `recursiveOf`.
 */
function expandDefinition(
  document: SwaggerDocument,
  definitionKey: string,
  budget: ExpansionBudget,
  depth: number,
  path: string,
  visited: Map<string, string>,
): KubespecProperty[] {
  const definition = document.definitions?.[definitionKey];
  if (!definition?.properties) {
    return [];
  }

  visited.set(definitionKey, path);

  const required = new Set(definition.required ?? []);
  const result: KubespecProperty[] = [];

  for (const name of Object.keys(definition.properties).sort()) {
    if (!budget.claim(depth)) {
      break;
    }
    result.push(
      expandProperty(
        document,
        name,
        definition.properties[name],
        required.has(name),
        budget,
        depth,
        `${path}.${name}`,
        visited,
      ),
    );
  }

  visited.delete(definitionKey);
  return result;
}

function expandProperty(
  document: SwaggerDocument,
  name: string,
  schema: SwaggerProperty,
  required: boolean,
  budget: ExpansionBudget,
  depth: number,
  path: string,
  visited: Map<string, string>,
): KubespecProperty {
  const isArray = schema.type === 'array';
  const value: SwaggerRef = isArray ? schema.items ?? {} : schema;
  const refKey = refKeyOf(value) ?? refKeyOf(schema.additionalProperties);
  const isMap = !isArray && schema.type === 'object' && schema.additionalProperties !== undefined;

  const property: KubespecProperty = {
    name,
    type: typeNameOf(schema, value, refKey, isMap),
    isArray,
    required,
    description: schema.description ?? '',
  };

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    property.enumValues = schema.enum.slice(0, MAX_ENUM_VALUES).map(entry => String(entry));
  }
  if (schema.default !== undefined) {
    property.defaultValue = JSON.stringify(schema.default);
  }
  if (value.format) {
    property.format = value.format;
  }

  if (refKey) {
    const seenAt = visited.get(refKey);
    if (seenAt !== undefined) {
      // Self-referential types such as JSONSchemaProps: stop, and say where the
      // same shape can be read instead of expanding forever.
      property.recursiveOf = seenAt === '' ? '.' : seenAt;
    } else if (hasProperties(document, refKey) && budget.canDescend(depth)) {
      // The `hasProperties` check comes first so that a scalar type sitting at the
      // depth limit does not mark the schema truncated when nothing was left out.
      const children = expandDefinition(document, refKey, budget, depth + 1, path, visited);
      if (children.length > 0) {
        property.children = children;
      }
    }
  }

  return property;
}

function hasProperties(document: SwaggerDocument, definitionKey: string): boolean {
  const definition = document.definitions?.[definitionKey];
  return Boolean(definition?.properties && Object.keys(definition.properties).length > 0);
}

function refKeyOf(value: SwaggerRef | undefined): string | undefined {
  const ref = value?.$ref;
  return ref?.startsWith(REF_PREFIX) ? ref.slice(REF_PREFIX.length) : undefined;
}

function typeNameOf(schema: SwaggerProperty, value: SwaggerRef, refKey: string | undefined, isMap: boolean): string {
  // `io.k8s.api.core.v1.PodSpec` reads as `PodSpec`, which is what the upstream
  // documentation calls it.
  const named = refKey ? refKey.split('.').pop() ?? refKey : undefined;

  if (isMap) {
    const valueType = named ?? schema.additionalProperties?.type ?? 'any';
    return `map[string]${valueType}`;
  }
  if (named) {
    return named;
  }
  return value.type ?? schema.type ?? 'any';
}
