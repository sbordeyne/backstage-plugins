import { CORE_GROUP, resourceLocation } from './location';

describe('resourceLocation', () => {
  it('builds the same five segments the page routes on', () => {
    expect(resourceLocation({ sourceSlug: 'kubernetes', group: 'apps', apiVersion: 'v1', kind: 'Deployment' })).toBe(
      '/kubespec/kubernetes/latest/apps/v1/Deployment',
    );
  });

  it('spells the core group with the alias the page expects', () => {
    // If this drifts from the frontend's `encodeGroupSegment`, every core-group
    // search result lands on a 404.
    expect(CORE_GROUP).toBe('core');
    expect(resourceLocation({ sourceSlug: 'kubernetes', group: '', apiVersion: 'v1', kind: 'Pod' })).toBe(
      '/kubespec/kubernetes/latest/core/v1/Pod',
    );
  });

  it('always points at latest, which is the only version indexed', () => {
    const location = resourceLocation({
      sourceSlug: 'cert-manager',
      group: 'cert-manager.io',
      apiVersion: 'v1',
      kind: 'Certificate',
    });

    expect(location).toContain('/latest/');
  });
});
