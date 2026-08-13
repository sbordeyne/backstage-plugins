import {
  apiSelfLink,
  formatResourceName,
  lastSegment,
  ownerLabelKeys,
  segmentAfter,
  toEntityTags,
  parseOwnerRef,
  parseSystemRef,
  readLabel,
  regionAnnotation,
  renderTemplate,
  selfLinkAnnotation,
  toEntityLabels,
} from './utils';
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

  it('trims the separators the catalog will not accept at either end', () => {
    // Firestore names its default database `(default)`.
    expect(formatResourceName('(default)')).toBe('default');
    expect(formatResourceName('_leading-and-trailing_')).toBe('leading-and-trailing');
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

describe('selfLinkAnnotation', () => {
  it('omits the annotation when the API reported no url', () => {
    expect(selfLinkAnnotation(undefined)).toEqual({});
    expect(selfLinkAnnotation(null)).toEqual({});
    expect(selfLinkAnnotation('')).toEqual({});
  });

  it('writes the annotation when there is a url', () => {
    expect(selfLinkAnnotation('https://pubsub.googleapis.com/v1/projects/p/topics/t')).toEqual({
      'cloud.google.com/self-link': 'https://pubsub.googleapis.com/v1/projects/p/topics/t',
    });
  });
});

describe('renderTemplate', () => {
  const context = { projectId: 'my-project', type: 'bucket', provider: 'gcp-bucket', region: 'europe-west1' };

  it('leaves a template without placeholders alone', () => {
    expect(renderTemplate('default', context)).toBe('default');
  });

  it('substitutes the resource facts', () => {
    expect(renderTemplate('gcp-${projectId}', context)).toBe('gcp-my-project');
    expect(renderTemplate('${provider}-${region}', context)).toBe('gcp-bucket-europe-west1');
  });

  it('substitutes an absent value with nothing', () => {
    expect(renderTemplate('${type}-${name}', context)).toBe('bucket-');
  });

  it('throws on an unknown variable, so config typos surface', () => {
    expect(() => renderTemplate('gcp-${project}', context)).toThrow(/Unknown template variable 'project'/);
  });
});

describe('toEntityLabels', () => {
  it('copies over the labels a resource carries', () => {
    expect(toEntityLabels({ env: 'prod', 'backstage_io_owner-ref': 'platform-team' })).toEqual({
      env: 'prod',
      'backstage_io_owner-ref': 'platform-team',
    });
  });

  it('keeps a prefixed key', () => {
    expect(toEntityLabels({ 'backstage.io/owner-ref': 'platform-team' })).toEqual({
      'backstage.io/owner-ref': 'platform-team',
    });
  });

  it('has nothing to copy when there are no labels', () => {
    expect(toEntityLabels(undefined)).toEqual({});
    expect(toEntityLabels(null)).toEqual({});
  });

  it('drops values the catalog would reject rather than emitting a rejected entity', () => {
    const labels = {
      empty: '',
      blank: '   ',
      missing: null,
      'trailing-dash': 'prod-',
      'spaced value': 'prod',
      'too/many/parts': 'prod',
      kept: 'prod',
    };
    expect(toEntityLabels(labels)).toEqual({ kept: 'prod' });
  });

  it('trims values, as reading a label does', () => {
    expect(toEntityLabels({ env: ' prod ' })).toEqual({ env: 'prod' });
  });
});

describe('toEntityTags', () => {
  it('folds a value into something searchable', () => {
    expect(toEntityTags(['POSTGRES_15', 'europe-west1'])).toEqual(['postgres-15', 'europe-west1']);
  });

  it('drops empties and duplicates', () => {
    expect(toEntityTags(['prod', 'prod', '', '   ', null, undefined, '---'])).toEqual(['prod']);
  });

  it('keeps the characters tags are allowed to carry', () => {
    expect(toEntityTags(['c++', 'c#'])).toEqual(['c++', 'c#']);
  });

  it('truncates to the catalog limit without a trailing separator', () => {
    const tag = toEntityTags([`${'a'.repeat(62)}_b`])[0];
    expect(tag).toHaveLength(62);
    expect(tag.endsWith('-')).toBe(false);
  });

  it('caps how many tags one entity gets', () => {
    expect(toEntityTags(Array.from({ length: 40 }, (_, index) => `tag-${index}`))).toHaveLength(25);
  });
});

describe('resource name helpers', () => {
  it('reads the leaf of a resource path', () => {
    expect(lastSegment('projects/p/locations/europe-west1/clusters/kafka')).toBe('kafka');
    expect(lastSegment(undefined)).toBe('');
  });

  it('reads a named segment of a resource path', () => {
    const name = 'projects/p/locations/europe-west1/clusters/kafka';
    expect(segmentAfter(name, 'locations')).toBe('europe-west1');
    expect(segmentAfter(name, 'zones')).toBeUndefined();
  });

  it('builds the canonical rest url of a resource', () => {
    expect(apiSelfLink('pubsub.googleapis.com', 'v1', 'projects/p/topics/t')).toBe(
      'https://pubsub.googleapis.com/v1/projects/p/topics/t',
    );
  });
});

describe('parseSystemRef', () => {
  it('reads a bare value as a system in the default namespace', () => {
    expect(parseSystemRef('payments')).toBe('system:default/payments');
  });

  it('keeps a value that already names a kind or namespace', () => {
    expect(parseSystemRef('system:infra/payments')).toBe('system:infra/payments');
  });

  it('throws on a value that is not a ref, leaving the caller to fall back', () => {
    expect(() => parseSystemRef('system:')).toThrow();
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
