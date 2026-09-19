import type { TagRules } from '../config';
import { selectTags } from './selectTags';

function rules(overrides: Partial<TagRules> = {}): TagRules {
  return { excludePrerelease: true, max: 10, ...overrides };
}

/**
 * The regression net for the declarative tag scheme.
 *
 * Each case is a project whose upstream tag predicate was a TypeScript function
 * in kubespec.dev, restated here as config. If a rule stops expressing one of
 * these, the corresponding source silently ingests the wrong releases — which is
 * exactly the failure the original has with vertical-pod-autoscaler today.
 */
describe('selectTags', () => {
  it('applies a minimum version, the common case', () => {
    const tags = ['v0.93.0', 'v0.93.1', 'v0.94.0'];
    expect(selectTags(tags, rules({ minVersion: 'v0.93.1' })).map(tag => tag.version)).toEqual(['v0.94.0', 'v0.93.1']);
  });

  it('returns newest first', () => {
    const tags = ['v1.2.0', 'v1.10.0', 'v1.9.0'];
    expect(selectTags(tags, rules()).map(tag => tag.version)).toEqual(['v1.10.0', 'v1.9.0', 'v1.2.0']);
  });

  it('caps the result, the only cost control for a project with no floor', () => {
    const tags = Array.from({ length: 40 }, (_, index) => `v1.0.${index}`);
    expect(selectTags(tags, rules({ regex: '^v\\d+\\.\\d+\\.\\d+$', max: 10 })).length).toBe(10);
  });

  describe('cert-manager', () => {
    it('keeps releases and drops the cmd/ctl tags', () => {
      const tags = ['v1.21.1', 'v1.22.0', 'cmd/ctl/v1.21.1', 'v1.20.0'];
      const selected = selectTags(tags, rules({ regex: '^v\\d+\\.\\d+\\.\\d+$', minVersion: 'v1.21.1' }));
      expect(selected.map(tag => tag.version)).toEqual(['v1.22.0', 'v1.21.1']);
    });
  });

  describe('cilium', () => {
    it('keeps one spelling of a release published under two', () => {
      // Cilium publishes both `1.20.1` and `v1.20.1` for the same release.
      const tags = ['1.20.1', 'v1.20.1', '1.20.2', 'v1.20.2'];
      const selected = selectTags(tags, rules({ regex: '^\\d+\\.\\d+\\.\\d+$', minVersion: '1.20.1' }));
      expect(selected.map(tag => tag.tag)).toEqual(['1.20.2', '1.20.1']);
    });
  });

  describe('vertical-pod-autoscaler', () => {
    const vpaRules = rules({
      prefix: 'vertical-pod-autoscaler-chart-',
      regex: '^\\d+\\.\\d+\\.\\d+$',
    });

    it('strips the prefix before parsing, and reports the stripped version', () => {
      const tags = [
        'vertical-pod-autoscaler-chart-1.2.3',
        'vertical-pod-autoscaler-chart-1.3.0',
        'cluster-autoscaler-1.30.0',
        'v1.30.0',
      ];

      // The upstream downloader drops every one of these before its own filter
      // runs, because its global blacklist matches the substring "chart".
      expect(selectTags(tags, vpaRules)).toEqual([
        { tag: 'vertical-pod-autoscaler-chart-1.3.0', version: '1.3.0', sortKey: expect.any(String) },
        { tag: 'vertical-pod-autoscaler-chart-1.2.3', version: '1.2.3', sortKey: expect.any(String) },
      ]);
    });

    it('drops tags without the prefix', () => {
      expect(selectTags(['1.2.3'], vpaRules)).toEqual([]);
    });
  });

  describe('eck-operator', () => {
    it('drops build candidates via the prerelease rule', () => {
      const tags = ['v3.5.0', 'v3.5.0-bc1', 'v3.6.0'];
      expect(selectTags(tags, rules({ minVersion: 'v3.5.0' })).map(tag => tag.version)).toEqual(['v3.6.0', 'v3.5.0']);
    });

    it('keeps prereleases when asked to', () => {
      const tags = ['v3.5.0', 'v3.5.0-bc1'];
      expect(selectTags(tags, rules({ excludePrerelease: false })).map(tag => tag.version)).toEqual([
        'v3.5.0',
        'v3.5.0-bc1',
      ]);
    });
  });

  describe('istio', () => {
    it('keeps only bare three-part releases', () => {
      const tags = ['1.30.3', '1.31.0', '1.30.0', 'istio-1.31.0', '1.31.0-beta.0'];
      expect(
        selectTags(tags, rules({ regex: '^\\d+\\.\\d+\\.\\d+$', minVersion: '1.30.3' })).map(t => t.version),
      ).toEqual(['1.31.0', '1.30.3']);
    });
  });

  describe('exclusions', () => {
    it('applies exclude to the raw tag, before the prefix comes off', () => {
      const tags = ['v1.2.3', 'nightly-v1.2.4'];
      expect(selectTags(tags, rules({ exclude: '^nightly-' })).map(tag => tag.version)).toEqual(['v1.2.3']);
    });
  });

  it('drops an unparseable tag instead of throwing', () => {
    expect(() => selectTags(['main', 'HEAD', 'v1.0.0'], rules())).not.toThrow();
    expect(selectTags(['main', 'HEAD', 'v1.0.0'], rules()).map(tag => tag.version)).toEqual(['v1.0.0']);
  });
});
