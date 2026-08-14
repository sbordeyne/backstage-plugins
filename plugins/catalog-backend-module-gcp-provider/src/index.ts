/***/
/**
 * The gcp-provider backend module for the catalog plugin.
 *
 * @packageDocumentation
 */

export { catalogModuleGcpProvider, catalogModuleGcpProvider as default } from './module';

/**
 * The annotations this module writes onto the entities it ingests.
 *
 * Exported so a frontend card, a processor or a custom provider can read them by name rather than
 * repeating the string — `cloud.google.com/project-id` written out by hand in a plugin is a
 * dependency on this module that nothing checks.
 */
export {
  ANNOTATION_GCP_ASSET_NAME,
  ANNOTATION_GCP_IAM_ACCESS,
  ANNOTATION_GCP_IAM_MEMBERS,
  ANNOTATION_GCP_IAM_PERMISSIONS,
  ANNOTATION_GCP_IAM_PROJECT_ROLES,
  ANNOTATION_GCP_IAM_ROLES,
  ANNOTATION_GCP_KSA_NAMESPACE,
  ANNOTATION_GCP_MACHINE_TYPE,
  ANNOTATION_GCP_PEERINGS,
  ANNOTATION_GCP_PROJECT_ID,
  ANNOTATION_GCP_REGION,
  ANNOTATION_GCP_SELF_LINK,
  ANNOTATION_GCP_SERVICE_ACCOUNT,
  ANNOTATION_GCP_STATUS,
  ANNOTATION_GCP_WORKLOAD_IDENTITY_POOL,
  DEFAULT_NAMESPACE_TEMPLATE,
  DEFAULT_OWNER_LABEL,
  DEFAULT_SYSTEM_LABEL,
  FALLBACK_NAMESPACE,
  GCP_CONSOLE_URL,
  MAX_ANNOTATION_LENGTH,
  MAX_TAGS,
} from './constants';

/**
 * The relation vocabulary emitted under `iam.relations: gcp`.
 *
 * Custom relation types are strings the catalog knows nothing about, so anything reading them —
 * a Catalog Graph card configured to show access edges, a filter, a test — needs the same names
 * this module emits. `allRelationTypes()` is the whole set, for wiring a graph view in one line.
 */
export {
  DEPENDS_ON_RELATION,
  IAM_RELATIONS,
  STRUCTURAL_RELATIONS,
  allRelationTypes,
  classifyRole,
  relationForRole,
  relationForStructure,
} from './relations';
export type { IamRelationKind, RelationMode, RelationPair, StructuralRelationKind } from './relations';

/**
 * The resource types this module ingests, with the `spec.type`, documentation link and Cloud Asset
 * Inventory type of each — for building a filter, a legend or a type-aware entity page.
 */
export { RESOURCE_CONFIG_KEYS, RESOURCE_TYPES } from './resourceTypes';
export type { GcpNameStyle, GcpResourceType } from './resourceTypes';
