import { categorizePropertyType, getPropertyTypePalette } from './propertyTypePalette';

describe('categorizePropertyType', () => {
  it('reads an expandable node as an object whatever it is called', () => {
    expect(categorizePropertyType('PodSpec', true)).toBe('object');
    expect(categorizePropertyType('object', false)).toBe('object');
    expect(categorizePropertyType('map[string]string', false)).toBe('object');
  });

  it('separates the scalar kinds', () => {
    expect(categorizePropertyType('string', false)).toBe('string');
    expect(categorizePropertyType('integer', false)).toBe('number');
    expect(categorizePropertyType('number', false)).toBe('number');
    expect(categorizePropertyType('boolean', false)).toBe('boolean');
  });

  it('treats the time types as timestamps even though they are strings', () => {
    expect(categorizePropertyType('Time', false)).toBe('timestamp');
    expect(categorizePropertyType('MicroTime', false)).toBe('timestamp');
  });

  it('files an unexpandable named type as opaque, not as an object', () => {
    // kubespec.dev branches on two literal type names, so every named type it has
    // not heard of lands in one colour — which is most of them.
    expect(categorizePropertyType('RawExtension', false)).toBe('opaque');
    expect(categorizePropertyType('IntOrString', false)).toBe('opaque');
    expect(categorizePropertyType('SomeFutureType', false)).toBe('opaque');
  });
});

describe('getPropertyTypePalette', () => {
  it('paints its own panel in dark mode rather than the theme surface', () => {
    // The happn dark theme's paper is a mid grey nothing can reach 3:1 against.
    expect(getPropertyTypePalette(true).surface).toBe('#1E1D1B');
    expect(getPropertyTypePalette(false).surface).toBe('#FBF8F1');
  });

  it('gives every category a distinct colour in both modes', () => {
    for (const isDark of [false, true]) {
      const palette = getPropertyTypePalette(isDark);
      const colours = [
        palette.object,
        palette.string,
        palette.number,
        palette.boolean,
        palette.timestamp,
        palette.opaque,
      ];
      expect(new Set(colours).size).toBe(colours.length);
    }
  });
});
