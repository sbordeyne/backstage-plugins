import * as api from './index';
import { RESOURCE_TYPES } from './resourceTypes';

describe('the public api', () => {
  it('exports the module both by name and as the default', () => {
    expect(api.catalogModuleGcpProvider).toBeDefined();
    expect(api.default).toBe(api.catalogModuleGcpProvider);
  });

  it('exports the annotations it writes, so nothing downstream has to repeat the strings', () => {
    expect(api.ANNOTATION_GCP_PROJECT_ID).toBe('cloud.google.com/project-id');
    expect(api.ANNOTATION_GCP_SERVICE_ACCOUNT).toBe('cloud.google.com/service-account');
    expect(api.DEFAULT_NAMESPACE_TEMPLATE).toBe('gcp-{{projectId}}');
  });

  it('exports the custom relation vocabulary, both halves of every pair', () => {
    // A Catalog Graph card showing access edges needs these names, and they exist nowhere in
    // `@backstage/catalog-model` to be imported from.
    const types = api.allRelationTypes();
    expect(types).toContain(api.IAM_RELATIONS.accessor.forward);
    expect(types).toContain(api.IAM_RELATIONS.accessor.reverse);
    expect(types).toContain(api.STRUCTURAL_RELATIONS.attachedTo.forward);
    expect(api.classifyRole('roles/pubsub.publisher')).toBe('publisher');
    expect(api.relationForRole('roles/pubsub.publisher', 'gcp').forward).toBe('publisherTo');
    expect(api.relationForRole('roles/pubsub.publisher', 'builtin')).toBe(api.DEPENDS_ON_RELATION);
  });

  it('exports the resource type registry', () => {
    expect(api.RESOURCE_TYPES).toBe(RESOURCE_TYPES);
    expect(api.RESOURCE_CONFIG_KEYS).toContain('storage');
  });
});
