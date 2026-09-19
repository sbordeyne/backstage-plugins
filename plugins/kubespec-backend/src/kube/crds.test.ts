import { normalizeCrds } from './crds';
import { DEFAULT_EXPANSION_LIMITS } from './model';

function crd(body: string): string {
  return `apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
metadata:
  name: widgets.example.com
spec:
  group: example.com
  scope: Namespaced
  names:
    kind: Widget
  versions:
${body}`;
}

function normalize(contents: string) {
  return normalizeCrds([{ path: 'crd.yaml', contents }], DEFAULT_EXPANSION_LIMITS);
}

describe('normalizeCrds', () => {
  it('emits one resource per served version, categorized by API group', () => {
    const { resources } = normalize(
      crd(`    - name: v1
      schema:
        openAPIV3Schema:
          description: A widget.
          type: object
          properties:
            spec:
              type: object
    - name: v1beta1
      schema:
        openAPIV3Schema:
          type: object
`),
    );

    expect(resources.map(resource => `${resource.apiVersionFull}/${resource.kind}`)).toEqual([
      'example.com/v1/Widget',
      'example.com/v1beta1/Widget',
    ]);
    expect(resources[0]).toMatchObject({ category: 'example.com', scope: 'Namespaced' });
    expect(resources[0].definition.description).toBe('A widget.');
  });

  it('marks required properties from the parent schema', () => {
    const { resources } = normalize(
      crd(`    - name: v1
      schema:
        openAPIV3Schema:
          type: object
          required: [spec]
          properties:
            spec:
              type: object
            status:
              type: object
`),
    );

    const byName = Object.fromEntries(resources[0].definition.properties.map(p => [p.name, p.required]));
    expect(byName).toEqual({ spec: true, status: false });
  });

  it('descends into items even when the item schema has no type', () => {
    // The upstream normalizer only descends when `items.type` is set, and
    // otherwise recurses into the array node itself — producing an empty subtree
    // for a shape that is common in CRDs.
    const { resources } = normalize(
      crd(`    - name: v1
      schema:
        openAPIV3Schema:
          type: object
          properties:
            containers:
              type: array
              items:
                properties:
                  name:
                    type: string
`),
    );

    const containers = resources[0].definition.properties[0];
    expect(containers).toMatchObject({ name: 'containers', isArray: true, type: 'object' });
    expect(containers.children?.map(child => child.name)).toEqual(['name']);
  });

  it('names the element type of a scalar array', () => {
    const { resources } = normalize(
      crd(`    - name: v1
      schema:
        openAPIV3Schema:
          type: object
          properties:
            names:
              type: array
              items:
                type: string
`),
    );

    expect(resources[0].definition.properties[0]).toMatchObject({ type: 'string', isArray: true });
  });

  it('renders additionalProperties as a map with the value schema underneath', () => {
    const { resources } = normalize(
      crd(`    - name: v1
      schema:
        openAPIV3Schema:
          type: object
          properties:
            selector:
              type: object
              additionalProperties:
                type: string
            limits:
              type: object
              additionalProperties:
                type: object
                properties:
                  cpu:
                    type: string
`),
    );

    const byName = Object.fromEntries(resources[0].definition.properties.map(p => [p.name, p]));
    expect(byName.selector.type).toBe('map[string]string');
    expect(byName.limits.type).toBe('map[string]object');
    // The value schema hangs off a synthetic node rather than being spliced in as
    // if its fields belonged to the map itself.
    expect(byName.limits.children?.[0].name).toBe('<key>');
    expect(byName.limits.children?.[0].children?.map(child => child.name)).toEqual(['cpu']);
  });

  it('keeps enum, default and format, which the upstream model drops', () => {
    const { resources } = normalize(
      crd(`    - name: v1
      schema:
        openAPIV3Schema:
          type: object
          properties:
            policy:
              type: string
              enum: [Always, Never]
              default: Always
            deadline:
              type: integer
              format: int64
            blob:
              x-kubernetes-preserve-unknown-fields: true
`),
    );

    const byName = Object.fromEntries(resources[0].definition.properties.map(p => [p.name, p]));
    expect(byName.policy).toMatchObject({ enumValues: ['Always', 'Never'], defaultValue: '"Always"' });
    expect(byName.deadline.format).toBe('int64');
    expect(byName.blob.preserveUnknownFields).toBe(true);
  });

  it('orders properties by name so the stored bytes are stable across runs', () => {
    const { resources } = normalize(
      crd(`    - name: v1
      schema:
        openAPIV3Schema:
          type: object
          properties:
            zeta:
              type: string
            alpha:
              type: string
`),
    );

    expect(resources[0].definition.properties.map(p => p.name)).toEqual(['alpha', 'zeta']);
  });

  it('ignores documents that are not v1 CRDs', () => {
    const contents = `apiVersion: v1
kind: ConfigMap
metadata:
  name: nothing
---
apiVersion: apiextensions.k8s.io/v1beta1
kind: CustomResourceDefinition
spec:
  group: old.example.com
  names:
    kind: Legacy
`;
    expect(normalize(contents).resources).toEqual([]);
  });

  it('recovers a CRD from an unterminated quote, as flagger publishes', () => {
    // flagger's crd.yaml opens a quote on the boilerplate `description` and never
    // closes it. The parser still recovers every kind and property; only that one
    // description is damaged, so dropping the file would cost the whole source to
    // save a sentence nobody reads.
    const contents = `apiVersion: apiextensions.k8s.io/v1
kind: CustomResourceDefinition
spec:
  group: flagger.app
  scope: Namespaced
  names:
    kind: Canary
  versions:
    - name: v1beta1
      schema:
        openAPIV3Schema:
          type: object
          properties:
            apiVersion:
              description: 'APIVersion defines the versioned schema of this representation
              of an object. Servers should convert recognized schemas.
              type: string
            spec:
              type: object
              properties:
                provider:
                  type: string
`;

    const { resources, warnings } = normalize(contents);

    expect(resources).toHaveLength(1);
    expect(resources[0].kind).toBe('Canary');
    expect(warnings[0]).toContain('recovered from malformed YAML');

    // Which sibling keys survive depends on where the parser resynchronises, so
    // the assertion is on what is guaranteed: the kind is not lost, and the
    // fragment the broken quote leaves behind — a whole sentence, which no
    // property name ever is — does not reach the stored schema.
    const names = resources[0].definition.properties.map(property => property.name);
    expect(names.length).toBeGreaterThan(0);
    expect(names.every(name => !/\s/.test(name))).toBe(true);
  });

  it('yields nothing rather than throwing on unreadable YAML', () => {
    // Whatever comes back is not a v1 CRD, so there is nothing to recover and
    // nothing worth warning about — but it must not take the file down with it.
    expect(() => normalize('a:\n  - b\n :::junk')).not.toThrow();
    expect(normalize('a:\n  - b\n :::junk').resources).toEqual([]);
  });

  it('truncates rather than failing when a schema exceeds the node budget', () => {
    const { resources } = normalizeCrds(
      [
        {
          path: 'crd.yaml',
          contents: crd(`    - name: v1
      schema:
        openAPIV3Schema:
          type: object
          properties:
            a:
              type: string
            b:
              type: string
            c:
              type: string
`),
        },
      ],
      { maxNodes: 2, maxDepth: 4 },
    );

    expect(resources[0].truncated).toBe(true);
    expect(resources[0].propertyCount).toBe(2);
  });
});
