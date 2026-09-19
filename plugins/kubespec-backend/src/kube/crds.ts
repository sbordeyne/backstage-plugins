import type { KubespecScope } from '@sbordeyne/kubespec-common';
import { parseAllDocuments } from 'yaml';

import { ExpansionBudget, ExpansionLimits, NormalizedResource, apiVersionFull } from './model';
import { OpenApiSchema, expandObjectSchema } from './openapi';

const CRD_API_VERSION = 'apiextensions.k8s.io/v1';

interface CustomResourceDefinition {
  kind?: string;
  apiVersion?: string;
  spec?: {
    group?: string;
    scope?: string;
    names?: { kind?: string };
    versions?: Array<{
      name?: string;
      served?: boolean;
      schema?: { openAPIV3Schema?: OpenApiSchema };
    }>;
  };
}

export interface ManifestFile {
  /** Repository-relative path, used only in warnings. */
  path: string;
  contents: string;
}

export interface NormalizeCrdsResult {
  resources: NormalizedResource[];
  /** Non-fatal problems: a malformed document must not fail a whole version. */
  warnings: string[];
}

/**
 * Normalizes every CustomResourceDefinition found in a version's manifests.
 *
 * Only `apiextensions.k8s.io/v1` CRDs are read. v1beta1 CRDs put the schema in a
 * different place and have been removed from Kubernetes since 1.22; treating them
 * as absent is simpler than maintaining a second reader for specs nobody serves.
 */
export function normalizeCrds(files: readonly ManifestFile[], limits: ExpansionLimits): NormalizeCrdsResult {
  const resources: NormalizedResource[] = [];
  const warnings: string[] = [];

  for (const file of files) {
    for (const crd of parseManifest(file, warnings)) {
      resources.push(...toResources(crd, file.path, limits, warnings));
    }
  }

  return { resources, warnings };
}

function parseManifest(file: ManifestFile, warnings: string[]): CustomResourceDefinition[] {
  let documents;
  try {
    documents = parseAllDocuments(file.contents);
  } catch (error) {
    warnings.push(`${file.path}: unreadable YAML (${(error as Error).message})`);
    return [];
  }

  const crds: CustomResourceDefinition[] = [];
  for (const document of documents) {
    // A parse error does not disqualify the document. Flagger, for one, publishes
    // a crd.yaml whose boilerplate `description` opens a quote it never closes;
    // the parser still recovers every kind and every property, losing only the
    // text of that one description. Dropping the file would cost the whole
    // source to save a sentence nobody reads.
    let value: CustomResourceDefinition | null;
    try {
      value = document.toJS() as CustomResourceDefinition | null;
    } catch (error) {
      warnings.push(`${file.path}: ${(error as Error).message}`);
      continue;
    }

    if (value?.kind !== 'CustomResourceDefinition' || value.apiVersion !== CRD_API_VERSION) {
      continue;
    }

    if (document.errors.length > 0) {
      warnings.push(
        `${file.path}: ${value.spec?.names?.kind ?? 'a CRD'} recovered from malformed YAML (${
          document.errors[0].message
        })`,
      );
    }
    crds.push(value);
  }
  return crds;
}

function toResources(
  crd: CustomResourceDefinition,
  path: string,
  limits: ExpansionLimits,
  warnings: string[],
): NormalizedResource[] {
  const group = crd.spec?.group;
  const kind = crd.spec?.names?.kind;
  if (!group || !kind) {
    warnings.push(`${path}: CustomResourceDefinition without spec.group or spec.names.kind`);
    return [];
  }

  const scope: KubespecScope = crd.spec?.scope === 'Cluster' ? 'Cluster' : 'Namespaced';

  return (crd.spec?.versions ?? []).flatMap(version => {
    if (!version.name) {
      warnings.push(`${path}: ${kind} has a version without a name`);
      return [];
    }

    const schema = version.schema?.openAPIV3Schema ?? {};
    const budget = new ExpansionBudget(limits);
    const properties = expandObjectSchema(schema, budget, 0);

    return [
      {
        group,
        version: version.name,
        kind,
        apiVersionFull: apiVersionFull(group, version.name),
        // A CRD source has no curated categories, so the API group is the only
        // grouping that means anything to a reader.
        category: group,
        scope,
        definition: { description: schema.description ?? '', properties },
        propertyCount: budget.count,
        treeDepth: budget.depth,
        truncated: budget.truncated,
      },
    ];
  });
}
