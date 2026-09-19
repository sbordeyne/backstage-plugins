import type { KubespecProperty, KubespecResourceDefinition } from '@sbordeyne/kubespec-common';

import { diffDefinitions, wordDiff } from './diff';

function property(name: string, overrides: Partial<KubespecProperty> = {}): KubespecProperty {
  return { name, type: 'string', isArray: false, required: false, description: '', ...overrides };
}

function definition(properties: KubespecProperty[]): KubespecResourceDefinition {
  return { description: '', properties };
}

describe('diffDefinitions', () => {
  it('reports an added property', () => {
    const result = diffDefinitions(definition([property('a')]), definition([property('a'), property('b')]));

    expect(result.addedCount).toBe(1);
    expect(result.changes).toEqual([
      expect.objectContaining({ changeType: 'new', path: '.b', pathCount: 1, depth: 0 }),
    ]);
  });

  it('reports a new object at its root only, not every descendant', () => {
    const added = property('spec', {
      type: 'object',
      children: [property('replicas'), property('paused', { type: 'boolean' })],
    });
    const result = diffDefinitions(definition([]), definition([added]));

    expect(result.addedCount).toBe(1);
    expect(result.changes.map(change => change.path)).toEqual(['.spec']);
  });

  it('reports a removed property', () => {
    const result = diffDefinitions(definition([property('a'), property('b')]), definition([property('a')]));

    expect(result.removedCount).toBe(1);
    expect(result.changes).toEqual([expect.objectContaining({ changeType: 'removed', path: '.b' })]);
  });

  it('descends past a property whose own description changed', () => {
    // The upstream implementation stops here, hiding every change underneath an
    // edited node. This is the behaviour that regression guards.
    const before = definition([
      property('spec', { type: 'object', description: 'old', children: [property('replicas')] }),
    ]);
    const after = definition([
      property('spec', { type: 'object', description: 'new', children: [property('replicas'), property('paused')] }),
    ]);

    const result = diffDefinitions(before, after);

    expect(result.descriptionChangedCount).toBe(1);
    expect(result.addedCount).toBe(1);
    expect(result.changes.map(change => change.path)).toContain('.spec.paused');
  });

  it('reports a type change, which the upstream diff never surfaces', () => {
    const before = definition([property('port', { type: 'string' })]);
    const after = definition([property('port', { type: 'IntOrString' })]);

    const result = diffDefinitions(before, after);

    expect(result.typeChangedCount).toBe(1);
    expect(result.changes).toEqual([
      expect.objectContaining({ changeType: 'type', previousValue: 'string', nextValue: 'IntOrString' }),
    ]);
  });

  it('treats an array of X as a different type from a bare X', () => {
    const result = diffDefinitions(
      definition([property('items', { type: 'Container' })]),
      definition([property('items', { type: 'Container', isArray: true })]),
    );

    expect(result.changes).toEqual([expect.objectContaining({ previousValue: 'Container', nextValue: 'Container[]' })]);
  });

  it('groups one shared-type edit into a single change across every path it reaches', () => {
    // A doc comment on a shared Go struct resurfaces at every path embedding it:
    // measured at 1,403 paths for one prometheus-operator release.
    const shared = (description: string): KubespecProperty[] => [
      property('a', { type: 'object', children: [property('name', { description })] }),
      property('b', { type: 'object', children: [property('name', { description })] }),
      property('c', { type: 'object', children: [property('name', { description })] }),
    ];

    const result = diffDefinitions(definition(shared('old text')), definition(shared('new text')));

    expect(result.descriptionChangedCount).toBe(1);
    expect(result.descriptionChangedPaths).toBe(3);

    const [change] = result.changes;
    expect(change.pathCount).toBe(3);
    expect(change.paths).toEqual(['.a.name', '.b.name', '.c.name']);
    // The shallowest affected path is the one a reader can actually place.
    expect(change.path).toBe('.a.name');
  });

  it('keeps distinct edits apart even when they touch the same path count', () => {
    const before = definition([property('a', { description: 'one' }), property('b', { description: 'two' })]);
    const after = definition([property('a', { description: 'ONE' }), property('b', { description: 'TWO' })]);

    expect(diffDefinitions(before, after).descriptionChangedCount).toBe(2);
  });

  it('attaches a precomputed word diff to a description change', () => {
    const result = diffDefinitions(
      definition([property('a', { description: 'Number of desired pods' })]),
      definition([property('a', { description: 'Number of requested pods' })]),
    );

    const [change] = result.changes;
    expect(change.diff).toBeDefined();
    expect(change.diff?.filter(span => span.kind === 'added').map(span => span.value.trim())).toEqual(['requested']);
    expect(change.diff?.filter(span => span.kind === 'removed').map(span => span.value.trim())).toEqual(['desired']);
  });

  it('reports nothing for identical schemas', () => {
    const same = definition([property('a', { type: 'object', children: [property('b')] })]);
    expect(diffDefinitions(same, same).changes).toEqual([]);
  });
});

describe('wordDiff', () => {
  it('marks unchanged runs as equal so the UI can render them plainly', () => {
    const spans = wordDiff('the quick fox', 'the slow fox');
    expect(spans.some(span => span.kind === 'equal')).toBe(true);
    expect(spans.map(span => span.value).join('')).toContain('fox');
  });
});
