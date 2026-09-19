import {
  apiVersionMajor,
  compareApiVersion,
  compareVersions,
  isPrerelease,
  parseVersion,
  sortVersionsDescending,
  versionSortKey,
} from './versions';

describe('parseVersion', () => {
  it.each([
    ['v1.34', { major: 1, minor: 34, patch: 0 }],
    ['1.31.0', { major: 1, minor: 31, patch: 0 }],
    ['v1.2.3', { major: 1, minor: 2, patch: 3 }],
    ['0.117.0', { major: 0, minor: 117, patch: 0 }],
    ['v2', { major: 2, minor: 0, patch: 0 }],
  ])('parses %s', (raw, expected) => {
    expect(parseVersion(raw)).toMatchObject(expected);
  });

  it('keeps the prerelease identifiers', () => {
    expect(parseVersion('v1.2.3-rc.1')?.prerelease).toBe('rc.1');
    // eck-operator publishes build candidates as -bc1, which is a semver prerelease.
    expect(parseVersion('3.5.0-bc1')?.prerelease).toBe('bc1');
  });

  it('ignores build metadata, which carries no ordering', () => {
    expect(parseVersion('v1.2.3+build.7')).toMatchObject({ major: 1, minor: 2, patch: 3 });
  });

  it.each(['main', 'cmd/ctl/v1.2.3', 'vertical-pod-autoscaler-chart-1.2.3', ''])(
    'returns null rather than throwing for %s',
    raw => {
      expect(parseVersion(raw)).toBeNull();
    },
  );
});

describe('isPrerelease', () => {
  it('distinguishes releases from prereleases', () => {
    expect(isPrerelease('v1.2.3')).toBe(false);
    expect(isPrerelease('v1.2.3-rc.1')).toBe(true);
  });
});

describe('versionSortKey', () => {
  it('sorts as a plain string, which is what the database relies on', () => {
    const keys = ['v1.9.0', 'v1.10.0', 'v1.2.0'].map(versionSortKey);
    expect([...keys].sort()).toEqual([versionSortKey('v1.2.0'), versionSortKey('v1.9.0'), versionSortKey('v1.10.0')]);
  });

  it('ranks a release above its own prereleases', () => {
    expect(versionSortKey('v1.2.3-rc.1') < versionSortKey('v1.2.3')).toBe(true);
  });

  it('puts unparseable versions below every parseable one', () => {
    expect(versionSortKey('nonsense') < versionSortKey('v0.0.1')).toBe(true);
  });
});

describe('compareVersions', () => {
  it('orders numerically rather than lexically', () => {
    expect(compareVersions('v1.10.0', 'v1.9.0')).toBeGreaterThan(0);
  });

  it('tolerates a leading v on either side, so config need not match the tag exactly', () => {
    expect(compareVersions('1.30.3', 'v1.30.3')).toBe(0);
  });

  it('never throws on input it cannot parse', () => {
    expect(() => compareVersions('main', 'v1.0.0')).not.toThrow();
  });
});

describe('sortVersionsDescending', () => {
  it('returns a new array, unlike semver.rsort', () => {
    const input = ['v1.2.0', 'v1.10.0'];
    expect(sortVersionsDescending(input)).toEqual(['v1.10.0', 'v1.2.0']);
    expect(input).toEqual(['v1.2.0', 'v1.10.0']);
  });
});

describe('compareApiVersion', () => {
  it('orders by maturity', () => {
    expect(compareApiVersion('v1', 'v1beta1')).toBeGreaterThan(0);
    expect(compareApiVersion('v1beta2', 'v1beta1')).toBeGreaterThan(0);
    expect(compareApiVersion('v1beta1', 'v1alpha1')).toBeGreaterThan(0);
    expect(compareApiVersion('v2', 'v1')).toBeGreaterThan(0);
  });

  it('never throws on an exotic version, which would otherwise fail a whole import', () => {
    expect(() => compareApiVersion('v1p1beta1', 'v1')).not.toThrow();
    // An unparseable version sorts below a parseable one rather than winning the
    // collapse and hiding the real API version.
    expect(compareApiVersion('v1p1beta1', 'v1')).toBeLessThan(0);
  });
});

describe('apiVersionMajor', () => {
  it('does not conflate v1 and v10', () => {
    expect(apiVersionMajor('v1')).toBe('1');
    expect(apiVersionMajor('v10alpha1')).toBe('10');
    expect(apiVersionMajor('v1')).not.toBe(apiVersionMajor('v10'));
  });
});
