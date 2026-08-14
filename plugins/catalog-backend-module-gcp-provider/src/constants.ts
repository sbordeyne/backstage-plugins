export const ANNOTATION_GCP_PROJECT_ID = 'cloud.google.com/project-id';
export const ANNOTATION_GCP_REGION = 'cloud.google.com/region';
export const ANNOTATION_GCP_SERVICE_ACCOUNT = 'cloud.google.com/service-account';

/**
 * Canonical GCP URL of the resource an entity was ingested from, so the catalog entry links back to
 * the thing it describes.
 */
export const ANNOTATION_GCP_SELF_LINK = 'cloud.google.com/self-link';

/**
 * Label read off a GCP resource to find the entity that owns it, unless `ownerLabel` says
 * otherwise.
 *
 * Spelled the way GCP will actually accept it. A label key has to match {@link GCP_LABEL_KEY} —
 * start with a lowercase letter, then lowercase letters, digits, dashes and underscores — so the
 * Backstage-style `backstage.io/owner-ref` cannot be set on a resource at all: the API rejects the
 * dots and the slash. The underscore spelling is what a real resource carries.
 */
export const DEFAULT_OWNER_LABEL = 'backstage_io_owner-ref';

/**
 * Label read off a GCP resource to find the system it belongs to, unless `systemLabel` says
 * otherwise. Spelled GCP-legally for the same reason as {@link DEFAULT_OWNER_LABEL}.
 */
export const DEFAULT_SYSTEM_LABEL = 'backstage_io_system-ref';

/**
 * What GCP accepts as a label key: 1–63 characters, opening with a lowercase letter, then lowercase
 * letters, digits, dashes and underscores.
 *
 * Values are restricted the same way except that they may also be empty, which is why they are
 * checked separately where it matters.
 */
export const GCP_LABEL_KEY = /^[a-z][a-z0-9_-]{0,62}$/;

/**
 * Namespace template used when neither the provider nor `catalog.providers.gcp` sets one.
 *
 * Entity names come from GCP, which scopes most of them to a project rather than globally: every
 * project has a `default` VPC network and subnet, and firewall rules, service accounts and secrets
 * repeat across projects by convention. Putting them all in one namespace gives two projects the
 * same entity ref, and a `full` mutation carrying the same ref twice keeps one resource and loses
 * the other. Namespacing by project is what makes ingesting more than one project work at all.
 */
export const DEFAULT_NAMESPACE_TEMPLATE = 'gcp-{{projectId}}';

/**
 * Namespace an entity lands in when its template cannot be rendered — an unknown variable, or a
 * result that normalizes to nothing.
 *
 * Deliberately not a template: it is the answer to "this configuration is broken", so it has to be
 * a namespace already rather than something that could fail to render in turn.
 */
export const FALLBACK_NAMESPACE = 'default';

/** Names of the VPC peerings configured on a network, which have no resources of their own. */
export const ANNOTATION_GCP_PEERINGS = 'cloud.google.com/vpc-peerings';

/** Machine type of a Compute Engine instance. */
export const ANNOTATION_GCP_MACHINE_TYPE = 'cloud.google.com/machine-type';

/** Status the GCP API reports for a resource, e.g. `RUNNING`, `READY`, `DEPRECATED`. */
export const ANNOTATION_GCP_STATUS = 'cloud.google.com/status';

/** Distinct IAM roles a service account holds on resources, for the entity page. */
export const ANNOTATION_GCP_IAM_ROLES = 'cloud.google.com/iam-roles';

/** Which role a service account holds on which resource, as `resource=role;resource=role`. */
export const ANNOTATION_GCP_IAM_ACCESS = 'cloud.google.com/iam-access';

/**
 * Roles held at the project level, which grant access to every resource in it without naming any.
 * These deliberately produce no relations — see the README on why the graph is edge-based.
 */
export const ANNOTATION_GCP_IAM_PROJECT_ROLES = 'cloud.google.com/iam-project-roles';

/** Who holds which role on a resource, written only when `iam.annotateResources` is on. */
export const ANNOTATION_GCP_IAM_MEMBERS = 'cloud.google.com/iam-members';

/** Workload Identity pool a Kubernetes service account belongs to. */
export const ANNOTATION_GCP_WORKLOAD_IDENTITY_POOL = 'cloud.google.com/workload-identity-pool';

/** Kubernetes namespace of an ingested Kubernetes service account. */
export const ANNOTATION_GCP_KSA_NAMESPACE = 'cloud.google.com/ksa-namespace';

/**
 * Cloud Asset Inventory name of the resource an entity was ingested from.
 *
 * Written so anything downstream — the relation processor above all — can find the entity's IAM
 * policy without the provider having to hand it over.
 */
export const ANNOTATION_GCP_ASSET_NAME = 'cloud.google.com/asset-name';

/** Permissions a custom IAM role includes, truncated to fit an annotation. */
export const ANNOTATION_GCP_IAM_PERMISSIONS = 'cloud.google.com/iam-permissions';

/**
 * Longest annotation value this module writes.
 *
 * IAM annotations summarize lists that have no natural bound — a policy can carry hundreds of
 * members — and an entity is a poor place to store an unbounded string.
 */
export const MAX_ANNOTATION_LENGTH = 4000;

/** Root of the GCP console, which every console link hangs off. */
export const GCP_CONSOLE_URL = 'https://console.cloud.google.com';

/** Most tags a single entity is given, so a heavily labelled resource cannot flood the catalog. */
export const MAX_TAGS = 25;
