import { FUNCTION_SETS, FUNCTION_SET_DESCRIPTIONS, FUNCTION_SET_LABELS } from '../../engine';
import { SAMPLES } from './samples';

/**
 * The samples explain themselves in `{{/* … *\/}}` comments, which legitimately
 * name the constructs a set does *not* support. Only the executable part of the
 * template is meaningful to these assertions.
 */
const code = (template: string) => template.replace(/\{\{\/\*[\s\S]*?\*\/\}\}/g, '');

describe('samples', () => {
  it('ships one for every function set', () => {
    for (const set of FUNCTION_SETS) {
      expect(SAMPLES[set]).toBeDefined();
      expect(SAMPLES[set].template.trim()).not.toBe('');
      expect(FUNCTION_SET_LABELS[set]).toBeTruthy();
      expect(FUNCTION_SET_DESCRIPTIONS[set]).toBeTruthy();
    }
  });

  // Sprout renamed sprig's functions, so a sprout sample written with sprig
  // spellings would greet the user with "function not defined".
  it('does not use sprig-only function names in the sprout sample', () => {
    const sprigOnly = [
      'upper',
      'lower',
      'b64enc',
      'b64dec',
      'kebabcase',
      'camelcase',
      'snakecase',
      'abbrev',
      'sha256sum',
    ];
    for (const name of sprigOnly) {
      expect(code(SAMPLES.sprout.template)).not.toMatch(new RegExp(`(\\||\\{\\{)\\s*${name}\\b`));
    }
  });

  // The ESO context is the flat secret map; `.Values` would silently be a
  // missing key, which under ESO's forced missingkey=error is a hard failure.
  it('addresses ESO data as flat keys rather than .Values', () => {
    expect(code(SAMPLES.eso.template)).not.toContain('.Values');
  });

  it('uses .Values for helm, since that is where chart values live', () => {
    expect(code(SAMPLES.helm.template)).toContain('.Values');
  });

  it('declares a data format each sample can actually be parsed as', () => {
    for (const set of FUNCTION_SETS) {
      const { data, dataFormat } = SAMPLES[set];
      expect(['yaml', 'json']).toContain(dataFormat);
      // JSON samples must parse; YAML is left to the Go engine's parser.
      const parses =
        dataFormat !== 'json' ||
        (() => {
          try {
            JSON.parse(data);
            return true;
          } catch {
            return false;
          }
        })();
      expect(parses).toBe(true);
    }
  });
});
