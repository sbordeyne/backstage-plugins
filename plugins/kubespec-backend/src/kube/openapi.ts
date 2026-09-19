import type { KubespecProperty } from '@sbordeyne/kubespec-common';

import { ExpansionBudget } from './model';

/**
 * The subset of OpenAPI v3 that a CRD's `openAPIV3Schema` uses.
 *
 * Deliberately loose: CRDs in the wild carry fields no published schema mentions,
 * and an over-tight type here would only push the casts elsewhere.
 */
export interface OpenApiSchema {
  type?: string;
  description?: string;
  format?: string;
  properties?: Record<string, OpenApiSchema>;
  required?: string[];
  items?: OpenApiSchema;
  additionalProperties?: OpenApiSchema | boolean;
  enum?: unknown[];
  default?: unknown;
  'x-kubernetes-preserve-unknown-fields'?: boolean;
  'x-kubernetes-int-or-string'?: boolean;
}

const MAX_ENUM_VALUES = 50;

/**
 * Expands an object schema's `properties` into the stored tree.
 *
 * Two departures from kubespec.dev, both correctness fixes:
 *
 * - An array always descends into `items`. The original only did so when
 *   `items.type` was set, and otherwise recursed into the array node itself,
 *   which yields an empty subtree for every `items` that carries only
 *   `properties` — common in CRDs.
 * - `additionalProperties` is rendered as a map with a synthetic value node,
 *   instead of a childless `object` that hides the whole value schema.
 */
export function expandObjectSchema(schema: OpenApiSchema, budget: ExpansionBudget, depth: number): KubespecProperty[] {
  const properties = schema.properties;
  if (!properties) {
    return [];
  }

  const required = new Set(schema.required ?? []);
  const result: KubespecProperty[] = [];

  // Sorted so the stored blob is byte-stable across runs: an unstable order would
  // change the content hash on every ingest and defeat the skip check.
  for (const name of Object.keys(properties).sort()) {
    if (!isPropertyName(name)) {
      continue;
    }
    if (!budget.claim(depth)) {
      break;
    }
    result.push(expandProperty(name, properties[name], required.has(name), budget, depth));
  }

  return result;
}

function expandProperty(
  name: string,
  schema: OpenApiSchema,
  required: boolean,
  budget: ExpansionBudget,
  depth: number,
): KubespecProperty {
  const isArray = schema.type === 'array';
  // For an array, everything that describes the value lives on `items`.
  const value: OpenApiSchema = isArray ? schema.items ?? {} : schema;

  const property: KubespecProperty = {
    name,
    type: typeNameOf(value),
    isArray,
    required,
    description: schema.description ?? value.description ?? '',
  };

  if (Array.isArray(value.enum) && value.enum.length > 0) {
    property.enumValues = value.enum.slice(0, MAX_ENUM_VALUES).map(entry => String(entry));
  }
  if (value.default !== undefined) {
    property.defaultValue = JSON.stringify(value.default);
  }
  if (value.format) {
    property.format = value.format;
  }
  if (value['x-kubernetes-preserve-unknown-fields']) {
    property.preserveUnknownFields = true;
  }

  const children = expandChildren(value, budget, depth);
  if (children.length > 0) {
    property.children = children;
  }

  return property;
}

/** `parentDepth` is the depth of the node whose children these are. */
function expandChildren(value: OpenApiSchema, budget: ExpansionBudget, parentDepth: number): KubespecProperty[] {
  const additional = value.additionalProperties;
  const hasChildren = Boolean(value.properties) || isSchema(additional);

  // Checked before the budget so that a leaf sitting exactly at the depth limit
  // does not mark the whole schema truncated: nothing was left out.
  if (!hasChildren || !budget.canDescend(parentDepth)) {
    return [];
  }

  const childDepth = parentDepth + 1;

  if (value.properties) {
    return expandObjectSchema(value, budget, childDepth);
  }

  if (isSchema(additional)) {
    // A map's value schema is shown under one synthetic node rather than being
    // spliced in as if its fields were the map's own.
    if (!budget.claim(childDepth)) {
      return [];
    }
    return [expandProperty('<key>', additional, false, budget, childDepth)];
  }

  return [];
}

function typeNameOf(schema: OpenApiSchema): string {
  if (schema['x-kubernetes-int-or-string']) {
    return 'IntOrString';
  }

  const additional = schema.additionalProperties;
  if (schema.type === 'object' && isSchema(additional)) {
    return `map[string]${typeNameOf(additional)}`;
  }

  if (schema.type) {
    return schema.type;
  }
  if (schema.properties) {
    return 'object';
  }
  // A schema with neither a type nor properties accepts anything; saying so beats
  // the empty string kubespec.dev stores, which renders as a blank type chip.
  return 'any';
}

/**
 * Rejects keys that cannot be real property names.
 *
 * Recovering a malformed document can leave a fragment of a broken string as a
 * key — a whole sentence, spaces and all. A Kubernetes property name never
 * contains whitespace, so this drops the artefact without touching valid input.
 */
function isPropertyName(name: string): boolean {
  return name.length > 0 && !/\s/.test(name);
}

function isSchema(value: OpenApiSchema | boolean | undefined): value is OpenApiSchema {
  return typeof value === 'object' && value !== null;
}
