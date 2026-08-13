import { allRelationTypes, classifyRole, relationForRole, relationForStructure } from './relations';

describe('classifyRole', () => {
  it('reads the verb a service uses for its own roles', () => {
    expect(classifyRole('roles/pubsub.publisher')).toBe('publisher');
    expect(classifyRole('roles/pubsub.subscriber')).toBe('subscriber');
    expect(classifyRole('roles/run.invoker')).toBe('invoker');
    expect(classifyRole('roles/cloudsql.client')).toBe('client');
    expect(classifyRole('roles/cloudkms.cryptoKeyEncrypterDecrypter')).toBe('encrypter');
    expect(classifyRole('roles/secretmanager.secretAccessor')).toBe('accessor');
  });

  it('falls back to the access level for everything else', () => {
    expect(classifyRole('roles/storage.objectViewer')).toBe('reader');
    expect(classifyRole('roles/storage.objectCreator')).toBe('writer');
    expect(classifyRole('roles/storage.admin')).toBe('admin');
    expect(classifyRole('roles/bigquery.dataEditor')).toBe('writer');
    expect(classifyRole('roles/bigquery.metadataViewer')).toBe('reader');
  });

  it('classifies a role it has never seen by its suffix', () => {
    expect(classifyRole('roles/somethingnew.viewer')).toBe('reader');
    expect(classifyRole('roles/somethingnew.admin')).toBe('admin');
    expect(classifyRole('projects/p/roles/customEditor')).toBe('user');
  });

  it('says only that access exists when the role names nothing recognizable', () => {
    // Better than guessing `admin`, and better than dropping the edge.
    expect(classifyRole('roles/iam.serviceAccountTokenCreator')).toBe('user');
  });
});

describe('relationForRole', () => {
  it('collapses every role to dependsOn in the built-in vocabulary', () => {
    expect(relationForRole('roles/storage.admin', 'builtin')).toEqual({
      forward: 'dependsOn',
      reverse: 'dependencyOf',
    });
  });

  it('names the verb in the GCP vocabulary, passive on the resource side', () => {
    expect(relationForRole('roles/secretmanager.secretAccessor', 'gcp')).toEqual({
      forward: 'accessorOf',
      reverse: 'accessedBy',
    });
    expect(relationForRole('roles/pubsub.publisher', 'gcp')).toEqual({
      forward: 'publisherTo',
      reverse: 'publishedToBy',
    });
  });
});

describe('relationForStructure', () => {
  it('reuses the built-in containment pair, which already means this', () => {
    expect(relationForStructure('partOf', 'gcp')).toEqual({ forward: 'partOf', reverse: 'hasPart' });
  });

  it('has a pair of its own for attachment, which has no built-in', () => {
    expect(relationForStructure('attachedTo', 'gcp')).toEqual({ forward: 'attachedTo', reverse: 'hasAttached' });
  });

  it('collapses both to dependsOn in the built-in vocabulary', () => {
    expect(relationForStructure('attachedTo', 'builtin').forward).toBe('dependsOn');
    expect(relationForStructure('partOf', 'builtin').forward).toBe('dependsOn');
  });
});

describe('allRelationTypes', () => {
  it('lists every type the module can emit, for the docs to stay honest', () => {
    const types = allRelationTypes();
    expect(types).toEqual(expect.arrayContaining(['accessorOf', 'accessedBy', 'attachedTo', 'hasAttached']));
    expect(new Set(types).size).toBe(types.length);
  });
});
