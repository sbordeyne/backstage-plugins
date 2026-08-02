import { formatResourceName, ownerLabelKeys, parseOwnerRef, readLabel, regionAnnotation } from './utils';
import { DEFAULT_OWNER_LABEL } from './constants';

describe('regionAnnotation', () => {
  it('omits the annotation when the region is unknown', () => {
    expect(regionAnnotation(undefined)).toEqual({});
    expect(regionAnnotation(null)).toEqual({});
    expect(regionAnnotation('')).toEqual({});
  });

  it('writes the annotation when the region is known', () => {
    expect(regionAnnotation('europe-west1')).toEqual({ 'cloud.google.com/region': 'europe-west1' });
  });
});

describe('formatResourceName', () => {
  it('truncates to the 63 character catalog limit', () => {
    expect(formatResourceName('a'.repeat(100))).toHaveLength(63);
  });

  it('replaces characters the catalog rejects', () => {
    expect(formatResourceName('My_Bucket.Name')).toBe('my-bucket-name');
  });
});

describe('ownerLabelKeys', () => {
  it('also matches the spelling GCP would accept', () => {
    expect(ownerLabelKeys(DEFAULT_OWNER_LABEL)).toEqual(['backstage.io/owner-ref', 'backstage_io_owner-ref']);
  });

  it('leaves an already legal key alone', () => {
    expect(ownerLabelKeys('backstage-owner-ref')).toEqual(['backstage-owner-ref']);
  });
});

describe('readLabel', () => {
  it('reads the configured key', () => {
    expect(readLabel({ 'backstage.io/owner-ref': 'platform-team' }, DEFAULT_OWNER_LABEL)).toBe('platform-team');
  });

  it('reads the GCP legal spelling of the configured key', () => {
    expect(readLabel({ 'backstage_io_owner-ref': 'platform-team' }, DEFAULT_OWNER_LABEL)).toBe('platform-team');
  });

  it('prefers the configured key over its folded form', () => {
    const labels = { 'backstage.io/owner-ref': 'exact', 'backstage_io_owner-ref': 'folded' };
    expect(readLabel(labels, DEFAULT_OWNER_LABEL)).toBe('exact');
  });

  it('ignores missing, empty and null values', () => {
    expect(readLabel(undefined, DEFAULT_OWNER_LABEL)).toBeUndefined();
    expect(readLabel(null, DEFAULT_OWNER_LABEL)).toBeUndefined();
    expect(readLabel({}, DEFAULT_OWNER_LABEL)).toBeUndefined();
    expect(readLabel({ 'backstage_io_owner-ref': '  ' }, DEFAULT_OWNER_LABEL)).toBeUndefined();
    expect(readLabel({ 'backstage_io_owner-ref': null }, DEFAULT_OWNER_LABEL)).toBeUndefined();
  });

  it('falls back to the folded key when the exact one is empty', () => {
    const labels = { 'backstage.io/owner-ref': '', 'backstage_io_owner-ref': 'platform-team' };
    expect(readLabel(labels, DEFAULT_OWNER_LABEL)).toBe('platform-team');
  });
});

describe('parseOwnerRef', () => {
  it('reads a bare value as a group in the default namespace', () => {
    expect(parseOwnerRef('platform-team')).toBe('group:default/platform-team');
  });

  it('keeps a value that already names a kind or namespace', () => {
    expect(parseOwnerRef('user:default/alice')).toBe('user:default/alice');
    expect(parseOwnerRef('group:infra/platform-team')).toBe('group:infra/platform-team');
  });

  it('throws on a value that is not a ref, leaving the caller to fall back', () => {
    expect(() => parseOwnerRef('group:')).toThrow();
    expect(() => parseOwnerRef('group:default/')).toThrow();
  });
});
