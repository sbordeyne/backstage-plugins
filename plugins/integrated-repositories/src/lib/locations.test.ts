import { Entity } from '@backstage/catalog-model';
import {
  isGeneratedLocation,
  isRootCatalogPath,
  parseGeneratedLocation,
  parseResolvedCatalogPath,
  toOriginLocationRef,
} from './locations';

function locationEntity(overrides: { name?: string; type?: string; target?: unknown; kind?: string }): Entity {
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: overrides.kind ?? 'Location',
    metadata: { name: overrides.name ?? 'generated-abc123' },
    spec: { type: overrides.type ?? 'url', target: overrides.target },
  } as Entity;
}

describe('parseGeneratedLocation', () => {
  it('reads org and repo from a provider-generated glob target', () => {
    const entity = locationEntity({
      target: 'https://github.com/happn-app/salt/blob/master/**/catalog-info.yaml',
    });

    expect(parseGeneratedLocation(entity)).toEqual({
      org: 'happn-app',
      repo: 'salt',
      target: 'https://github.com/happn-app/salt/blob/master/**/catalog-info.yaml',
    });
  });

  it('is not confused by a branch containing a slash', () => {
    const entity = locationEntity({
      target: 'https://github.com/happn-app/carbon/blob/release/1.x/**/catalog-info.yaml',
    });

    expect(parseGeneratedLocation(entity)).toMatchObject({ org: 'happn-app', repo: 'carbon' });
  });

  it('ignores manually registered locations', () => {
    const entity = locationEntity({
      name: 'backend',
      target: 'https://github.com/happn-app/salt/blob/master/**/catalog-info.yaml',
    });

    expect(parseGeneratedLocation(entity)).toBeUndefined();
  });

  it.each([
    ['a missing target', locationEntity({ target: undefined })],
    ['a non-string target', locationEntity({ target: 42 })],
    ['an unparseable target', locationEntity({ target: 'not-a-url' })],
    ['a non-url location type', locationEntity({ type: 'file', target: 'https://github.com/o/r/blob/main/x' })],
    ['a non-Location kind', locationEntity({ kind: 'Component', target: 'https://github.com/o/r/blob/main/x' })],
    ['a target without a blob segment', locationEntity({ target: 'https://github.com/happn-app/salt' })],
  ])('returns undefined for %s', (_label, entity) => {
    expect(parseGeneratedLocation(entity)).toBeUndefined();
  });
});

describe('isGeneratedLocation', () => {
  it('recognises a provider Location from kind and name alone, without spec', () => {
    const entity = { kind: 'Location', metadata: { name: 'generated-abc123' } } as Entity;

    expect(isGeneratedLocation(entity)).toBe(true);
  });

  it.each([
    ['a Location declared by hand', { kind: 'Location', metadata: { name: 'backend' } }],
    ['a non-Location kind', { kind: 'Component', metadata: { name: 'generated-abc123' } }],
  ])('rejects %s', (_label, entity) => {
    expect(isGeneratedLocation(entity as Entity)).toBe(false);
  });

  it.each([
    ['the glob the deployed config declares', 'templates/**/template.yaml'],
    ['a single template the reference config declares', 'templates/onboard-repository/template.yaml'],
  ])('rejects the templates location this repo declares, %s', (_label, path) => {
    const entity = locationEntity({ target: `https://github.com/happn-app/developer-portal/blob/master/${path}` });

    expect(isGeneratedLocation(entity)).toBe(false);
  });
});

describe('parseResolvedCatalogPath', () => {
  it('reads a root path', () => {
    expect(parseResolvedCatalogPath('url:https://github.com/happn-app/carbon/tree/master/catalog-info.yaml')).toBe(
      'catalog-info.yaml',
    );
  });

  it('reads a nested path', () => {
    expect(
      parseResolvedCatalogPath(
        'url:https://github.com/happn-app/backend/tree/master/services/front-api/catalog-info.yaml',
      ),
    ).toBe('services/front-api/catalog-info.yaml');
  });

  it('reads a deeply nested path', () => {
    expect(
      parseResolvedCatalogPath(
        'url:https://github.com/happn-app/docker/tree/master/images/backend/init/catalog-info.yaml',
      ),
    ).toBe('images/backend/init/catalog-info.yaml');
  });

  it('accepts a bare url without the location type prefix', () => {
    expect(parseResolvedCatalogPath('https://github.com/happn-app/carbon/tree/master/catalog-info.yaml')).toBe(
      'catalog-info.yaml',
    );
  });

  it('accepts a blob ref, produced when catalogPath is a literal rather than a glob', () => {
    expect(parseResolvedCatalogPath('url:https://github.com/happn-app/carbon/blob/master/catalog-info.yaml')).toBe(
      'catalog-info.yaml',
    );
  });

  it.each([
    ['an unparseable ref', 'url:nope'],
    ['a still-globbed path naming no single file', 'url:https://github.com/o/r/blob/main/**/catalog-info.yaml'],
    ['a ref with nothing after the branch', 'url:https://github.com/o/r/tree/main'],
  ])('returns undefined for %s', (_label, ref) => {
    expect(parseResolvedCatalogPath(ref)).toBeUndefined();
  });
});

describe('isRootCatalogPath', () => {
  it('accepts only the repository root file', () => {
    expect(isRootCatalogPath('catalog-info.yaml')).toBe(true);
    expect(isRootCatalogPath('services/api/catalog-info.yaml')).toBe(false);
  });
});

describe('toOriginLocationRef', () => {
  it('prefixes the target with the location type', () => {
    expect(toOriginLocationRef('https://github.com/o/r/blob/main/**/catalog-info.yaml')).toBe(
      'url:https://github.com/o/r/blob/main/**/catalog-info.yaml',
    );
  });
});
