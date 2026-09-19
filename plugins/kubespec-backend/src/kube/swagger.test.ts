import { DEFAULT_EXPANSION_LIMITS } from './model';
import { SwaggerDocument, normalizeSwagger } from './swagger';

const options = {
  limits: DEFAULT_EXPANSION_LIMITS,
  categoryByKind: { Deployment: 'Workloads', Node: 'Cluster' },
  defaultCategory: 'Other',
};

function listOperation(group: string, version: string, kind: string) {
  return {
    get: {
      'x-kubernetes-action': 'list',
      'x-kubernetes-group-version-kind': { group, version, kind },
    },
  };
}

describe('normalizeSwagger', () => {
  it('reads listable kinds and their categories', () => {
    const document: SwaggerDocument = {
      paths: {
        '/apis/apps/v1/namespaces/{namespace}/deployments': listOperation('apps', 'v1', 'Deployment'),
        '/api/v1/nodes': listOperation('', 'v1', 'Node'),
        '/apis/other/v1/widgets': listOperation('other', 'v1', 'Widget'),
      },
      definitions: {
        'io.k8s.api.apps.v1.Deployment': {
          description: 'A deployment.',
          'x-kubernetes-group-version-kind': [{ group: 'apps', version: 'v1', kind: 'Deployment' }],
          properties: {},
        },
        'io.k8s.api.core.v1.Node': {
          'x-kubernetes-group-version-kind': [{ group: '', version: 'v1', kind: 'Node' }],
          properties: {},
        },
        'io.k8s.api.other.v1.Widget': {
          'x-kubernetes-group-version-kind': [{ group: 'other', version: 'v1', kind: 'Widget' }],
          properties: {},
        },
      },
    };

    const { resources } = normalizeSwagger(document, options);
    const byKind = Object.fromEntries(resources.map(resource => [resource.kind, resource]));

    expect(byKind.Deployment).toMatchObject({ category: 'Workloads', apiVersionFull: 'apps/v1' });
    expect(byKind.Node).toMatchObject({ category: 'Cluster', apiVersionFull: 'v1' });
    // A kind nobody categorized still shows up, rather than needing a code change.
    expect(byKind.Widget.category).toBe('Other');
  });

  it('derives scope from the paths the kind is actually served on', () => {
    // Not from a reconstructed plural: `Endpoints` and `NetworkPolicy` are exactly
    // the kinds a pluralizer gets wrong, and a miss silently reports a namespaced
    // kind as cluster-scoped.
    const document: SwaggerDocument = {
      paths: {
        '/api/v1/namespaces/{namespace}/endpoints': listOperation('', 'v1', 'Endpoints'),
        '/api/v1/endpoints': listOperation('', 'v1', 'Endpoints'),
        '/api/v1/nodes': listOperation('', 'v1', 'Node'),
      },
      definitions: {
        'io.k8s.api.core.v1.Endpoints': {
          'x-kubernetes-group-version-kind': [{ group: '', version: 'v1', kind: 'Endpoints' }],
          properties: {},
        },
        'io.k8s.api.core.v1.Node': {
          'x-kubernetes-group-version-kind': [{ group: '', version: 'v1', kind: 'Node' }],
          properties: {},
        },
      },
    };

    const { resources } = normalizeSwagger(document, options);
    const byKind = Object.fromEntries(resources.map(resource => [resource.kind, resource.scope]));

    expect(byKind).toEqual({ Endpoints: 'Namespaced', Node: 'Cluster' });
  });

  it('ignores operations that are not list, and non-operation path members', () => {
    const document: SwaggerDocument = {
      paths: {
        '/api/v1/pods': {
          parameters: [{ name: 'pretty' }],
          get: {
            'x-kubernetes-action': 'watch',
            'x-kubernetes-group-version-kind': { group: '', version: 'v1', kind: 'Pod' },
          },
        },
      },
      definitions: {},
    };

    expect(normalizeSwagger(document, options).resources).toEqual([]);
  });

  it('expands $ref and names the type by its last segment', () => {
    const document: SwaggerDocument = {
      paths: { '/apis/apps/v1/deployments': listOperation('apps', 'v1', 'Deployment') },
      definitions: {
        'io.k8s.api.apps.v1.Deployment': {
          'x-kubernetes-group-version-kind': [{ group: 'apps', version: 'v1', kind: 'Deployment' }],
          required: ['spec'],
          properties: {
            spec: { $ref: '#/definitions/io.k8s.api.apps.v1.DeploymentSpec' },
            conditions: { type: 'array', items: { $ref: '#/definitions/io.k8s.api.apps.v1.Condition' } },
          },
        },
        'io.k8s.api.apps.v1.DeploymentSpec': {
          properties: { replicas: { type: 'integer', format: 'int32' } },
        },
        'io.k8s.api.apps.v1.Condition': {
          properties: { status: { type: 'string' } },
        },
      },
    };

    const { resources } = normalizeSwagger(document, options);
    const byName = Object.fromEntries(resources[0].definition.properties.map(p => [p.name, p]));

    expect(byName.spec).toMatchObject({ type: 'DeploymentSpec', required: true });
    expect(byName.spec.children?.map(child => child.name)).toEqual(['replicas']);
    expect(byName.conditions).toMatchObject({ type: 'Condition', isArray: true });
    expect(byName.conditions.children?.map(child => child.name)).toEqual(['status']);
  });

  it('stops at a self-referential type and says where the same shape lives', () => {
    const document: SwaggerDocument = {
      paths: { '/apis/x/v1/things': listOperation('x', 'v1', 'Thing') },
      definitions: {
        'io.x.v1.Thing': {
          'x-kubernetes-group-version-kind': [{ group: 'x', version: 'v1', kind: 'Thing' }],
          properties: { schema: { $ref: '#/definitions/io.x.v1.Props' } },
        },
        'io.x.v1.Props': {
          properties: { nested: { $ref: '#/definitions/io.x.v1.Props' } },
        },
      },
    };

    const { resources } = normalizeSwagger(document, options);
    const nested = resources[0].definition.properties[0].children?.[0];

    expect(nested).toMatchObject({ name: 'nested', type: 'Props', recursiveOf: '.schema' });
    expect(nested?.children).toBeUndefined();
  });

  it('expands a type reused in two branches in both of them', () => {
    const document: SwaggerDocument = {
      paths: { '/apis/x/v1/things': listOperation('x', 'v1', 'Thing') },
      definitions: {
        'io.x.v1.Thing': {
          'x-kubernetes-group-version-kind': [{ group: 'x', version: 'v1', kind: 'Thing' }],
          properties: {
            a: { $ref: '#/definitions/io.x.v1.Meta' },
            b: { $ref: '#/definitions/io.x.v1.Meta' },
          },
        },
        'io.x.v1.Meta': { properties: { name: { type: 'string' } } },
      },
    };

    const { resources } = normalizeSwagger(document, options);
    const [a, b] = resources[0].definition.properties;

    expect(a.children?.map(child => child.name)).toEqual(['name']);
    expect(b.children?.map(child => child.name)).toEqual(['name']);
  });

  it('warns about a listable kind with no schema rather than failing the version', () => {
    const document: SwaggerDocument = {
      paths: { '/apis/x/v1/things': listOperation('x', 'v1', 'Thing') },
      definitions: {},
    };

    const { resources, warnings } = normalizeSwagger(document, options);
    expect(resources).toEqual([]);
    expect(warnings).toEqual(['No schema definition for x/v1/Thing']);
  });
});
