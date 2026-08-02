export const ANNOTATION_GCP_PROJECT_ID = 'cloud.google.com/project-id';
export const ANNOTATION_GCP_REGION = 'cloud.google.com/region';
export const ANNOTATION_GCP_SERVICE_ACCOUNT = 'cloud.google.com/service-account';

/**
 * Label read off a GCP resource to find the entity that owns it, unless `ownerLabel` says
 * otherwise. See {@link ownerLabelKeys} for why the GCP-legal spelling matches too.
 */
export const DEFAULT_OWNER_LABEL = 'backstage.io/owner-ref';
