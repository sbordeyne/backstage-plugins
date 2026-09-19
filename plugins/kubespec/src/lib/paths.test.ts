import {
  CORE_GROUP_SEGMENT,
  ancestorPaths,
  apiVersionFull,
  decodeGroupSegment,
  encodeGroupSegment,
  parentPath,
  propertyName,
  resourcePath,
  sourcePath,
} from './paths';

describe('group segment', () => {
  it('round-trips the core group through a path segment', () => {
    // A URL cannot carry an empty segment unambiguously, which is the whole
    // reason the alias exists.
    expect(encodeGroupSegment('')).toBe(CORE_GROUP_SEGMENT);
    expect(decodeGroupSegment(CORE_GROUP_SEGMENT)).toBe('');
  });

  it('leaves a real group alone', () => {
    expect(encodeGroupSegment('cert-manager.io')).toBe('cert-manager.io');
    expect(decodeGroupSegment('cert-manager.io')).toBe('cert-manager.io');
  });
});

describe('resourcePath', () => {
  it('builds five segments for a grouped kind', () => {
    expect(
      resourcePath({
        sourceId: 'kubernetes',
        sourceVersion: 'latest',
        group: 'apps',
        apiVersion: 'v1',
        kind: 'Deployment',
      }),
    ).toBe('kubernetes/latest/apps/v1/Deployment');
  });

  it('builds five segments for a core kind too', () => {
    expect(
      resourcePath({
        sourceId: 'kubernetes',
        sourceVersion: 'v1.33',
        group: '',
        apiVersion: 'v1',
        kind: 'Pod',
      }),
    ).toBe('kubernetes/v1.33/core/v1/Pod');
  });

  it('escapes a segment that would otherwise break the path', () => {
    expect(
      resourcePath({
        sourceId: 'x',
        sourceVersion: 'v1',
        group: 'a/b',
        apiVersion: 'v1',
        kind: 'K',
      }),
    ).toBe('x/v1/a%2Fb/v1/K');
  });
});

describe('sourcePath', () => {
  it('builds two segments', () => {
    expect(sourcePath('cert-manager', 'v1.21.2')).toBe('cert-manager/v1.21.2');
  });
});

describe('apiVersionFull', () => {
  it('omits the slash for the core group', () => {
    expect(apiVersionFull('apps', 'v1')).toBe('apps/v1');
    expect(apiVersionFull('', 'v1')).toBe('v1');
  });
});

describe('property paths', () => {
  it('finds a parent, with the root as the empty string', () => {
    expect(parentPath('.spec.template.spec')).toBe('.spec.template');
    expect(parentPath('.spec')).toBe('');
  });

  it('finds a name', () => {
    expect(propertyName('.spec.template.spec')).toBe('spec');
    expect(propertyName('.spec')).toBe('spec');
  });

  it('lists every ancestor including the root', () => {
    // This is what a deep link expands, and it comes from splitting a string
    // rather than from walking the schema.
    expect(ancestorPaths('.spec.template.spec')).toEqual(['', '.spec', '.spec.template', '.spec.template.spec']);
  });

  it('returns just the root for an empty path', () => {
    expect(ancestorPaths('')).toEqual(['']);
  });
});
