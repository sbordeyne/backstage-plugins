import type { KubespecProperty, KubespecResourceDefinition } from '@sbordeyne/kubespec-common';

import { allExpandablePaths, buildSchemaIndex, filterProperties, flattenTree, initialExpanded } from './schemaTree';

function property(name: string, overrides: Partial<KubespecProperty> = {}): KubespecProperty {
  return { name, type: 'string', isArray: false, required: false, description: '', ...overrides };
}

const definition: KubespecResourceDefinition = {
  description: '',
  properties: [
    property('apiVersion'),
    property('metadata', {
      type: 'ObjectMeta',
      children: [property('name'), property('namespace')],
    }),
    property('spec', {
      type: 'DeploymentSpec',
      children: [
        property('replicas', { type: 'integer', description: 'Number of desired pods.' }),
        property('template', {
          type: 'PodTemplateSpec',
          children: [property('containers', { type: 'Container', isArray: true, children: [property('image')] })],
        }),
      ],
    }),
  ],
};

const index = buildSchemaIndex(definition);

describe('buildSchemaIndex', () => {
  it('keys every node by its path', () => {
    expect(index.nodes.get('.spec.template.spec')).toBeUndefined();
    expect(index.nodes.get('.spec.template.containers')?.type).toBe('Container');
    expect(index.childrenOf.get('')).toEqual(['.apiVersion', '.metadata', '.spec']);
    expect(index.childrenOf.get('.spec')).toEqual(['.spec.replicas', '.spec.template']);
  });
});

describe('initialExpanded', () => {
  it('opens top-level objects but not metadata', () => {
    // `metadata` is the same thirty fields on every kind, and opening it buries
    // the part of the schema a reader came for.
    expect([...initialExpanded(index)]).toEqual(['.spec']);
  });
});

describe('flattenTree', () => {
  it('returns only visible rows, in document order', () => {
    const rows = flattenTree(index, { expanded: new Set(['.spec']), described: new Set() });

    expect(rows.map(row => row.path)).toEqual([
      '.apiVersion',
      '.metadata',
      '.spec',
      '.spec.replicas',
      '.spec.template',
    ]);
  });

  it('reports depth as a number rather than by nesting', () => {
    const rows = flattenTree(index, {
      expanded: new Set(['.spec', '.spec.template', '.spec.template.containers']),
      described: new Set(),
    });

    const byPath = Object.fromEntries(rows.map(row => [row.path, row.depth]));
    expect(byPath['.spec']).toBe(0);
    expect(byPath['.spec.template']).toBe(1);
    expect(byPath['.spec.template.containers']).toBe(2);
    expect(byPath['.spec.template.containers.image']).toBe(3);
  });

  it('marks a collapsed node as having children, so a chevron is still drawn', () => {
    const rows = flattenTree(index, { expanded: new Set(), described: new Set() });
    const metadata = rows.find(row => row.path === '.metadata');

    expect(metadata).toMatchObject({ hasChildren: true, childCount: 2, isExpanded: false });
    expect(rows.some(row => row.path === '.metadata.name')).toBe(false);
  });

  it('numbers siblings for assistive technology', () => {
    const rows = flattenTree(index, { expanded: new Set(), described: new Set() });

    expect(rows.map(row => [row.positionInSet, row.siblingCount])).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('carries the description and focus flags through', () => {
    const rows = flattenTree(index, {
      expanded: new Set(['.spec']),
      described: new Set(['.spec.replicas']),
      focused: '.spec.replicas',
    });

    const replicas = rows.find(row => row.path === '.spec.replicas');
    expect(replicas).toMatchObject({ isDescriptionOpen: true, isFocused: true });
  });
});

describe('allExpandablePaths', () => {
  it('lists every node with children, and nothing else', () => {
    expect([...allExpandablePaths(index)].sort()).toEqual([
      '.metadata',
      '.spec',
      '.spec.template',
      '.spec.template.containers',
    ]);
  });
});

describe('filterProperties', () => {
  it('finds a property anywhere in the tree, shallowest first', () => {
    // The gap this closes: kubespec.dev offers no way to find a deep property
    // short of opening every node above it by hand.
    expect(filterProperties(index, 'name').map(match => match.path)).toEqual(['.metadata.name', '.metadata.namespace']);
  });

  it('matches a name only, so a parent does not drag its whole subtree along', () => {
    expect(filterProperties(index, 'containers').map(match => match.path)).toEqual(['.spec.template.containers']);
  });

  it('matches the full path once the query looks like one', () => {
    expect(filterProperties(index, '.spec.template').map(match => match.path)).toEqual([
      '.spec.template',
      '.spec.template.containers',
      '.spec.template.containers.image',
    ]);
  });

  it('matches a description as well as a name', () => {
    expect(filterProperties(index, 'desired pods').map(match => match.path)).toEqual(['.spec.replicas']);
  });

  it('returns nothing for a blank query', () => {
    expect(filterProperties(index, '   ')).toEqual([]);
  });

  it('is case-insensitive', () => {
    expect(filterProperties(index, 'CONTAINERS').map(match => match.path)).toEqual(['.spec.template.containers']);
  });
});
