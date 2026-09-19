/**
 * Type colours for the property tree.
 *
 * Same constraint the run-history chart hit, and the same answer: the happn dark
 * theme's `background.paper` is #767470, a *mid* grey sitting inside the very
 * lightness band these marks occupy, so nothing reaches 3:1 against it. The tree
 * therefore paints its own panel (#1E1D1B dark, #FBF8F1 light) and colours
 * against that — see `plugins/bruno/src/components/RunHistoryChart/chartPalette.ts`,
 * which documents the measurement.
 *
 * Six hues spread around the wheel for categorical separation, held in a narrow
 * lightness band so no single type shouts, and kept away from the theme's own
 * error #FC373E and success #64C75B so a type is never read as a status.
 *
 * Re-run the dataviz palette validator if either theme changes:
 *
 *   node scripts/validate_palette.js "#B3357E,#9A5518,#1F6FB2,#6B3FC4,#0F7268,#5C5852" --mode light --surface "#FBF8F1"
 *   node scripts/validate_palette.js "#EE86BE,#E0A567,#78B9EE,#B396F0,#5FC6B4,#A7A199" --mode dark  --surface "#1E1D1B"
 */

/**
 * Colour follows a semantic category, not the literal type string.
 *
 * kubespec.dev branches on `type === 'Time' || type === 'object'`, so every named
 * type it has not heard of falls through to one colour — which is most of them.
 */
export type PropertyTypeCategory = 'object' | 'string' | 'number' | 'boolean' | 'timestamp' | 'opaque';

const TIMESTAMP_TYPES = new Set(['Time', 'MicroTime', 'Duration']);
const OPAQUE_TYPES = new Set(['RawExtension', 'JSON', 'JSONSchemaProps', 'IntOrString', 'Quantity', 'any']);

export function categorizePropertyType(type: string, hasChildren: boolean): PropertyTypeCategory {
  if (TIMESTAMP_TYPES.has(type)) {
    return 'timestamp';
  }
  if (hasChildren || type === 'object' || type.startsWith('map[string]')) {
    return 'object';
  }
  if (type === 'string') {
    return 'string';
  }
  if (type === 'integer' || type === 'number') {
    return 'number';
  }
  if (type === 'boolean') {
    return 'boolean';
  }
  if (OPAQUE_TYPES.has(type)) {
    return 'opaque';
  }
  // A named type with no children is a leaf shape we could not expand; it reads
  // as opaque rather than as a plain scalar.
  return /^[A-Z]/.test(type) ? 'opaque' : 'string';
}

export interface PropertyTypePalette extends Record<PropertyTypeCategory, string> {
  /** The tree's own panel, which the colours above are measured against. */
  surface: string;
  border: string;
  /** The vertical indent guide. */
  guide: string;
  /** The `*` marking a required property. */
  required: string;
  /** The chip on a property whose type repeats one further up. */
  recursive: string;
  muted: string;
}

const LIGHT: PropertyTypePalette = {
  surface: '#FBF8F1',
  border: '#DCD6C9',
  guide: '#DCD6C9',
  object: '#B3357E',
  string: '#9A5518',
  number: '#1F6FB2',
  boolean: '#6B3FC4',
  timestamp: '#0F7268',
  opaque: '#5C5852',
  // Reuses the chart palette's already-validated red.
  required: '#A31515',
  recursive: '#8A6D00',
  muted: '#6B665F',
};

const DARK: PropertyTypePalette = {
  surface: '#1E1D1B',
  border: '#3A3833',
  guide: '#3A3833',
  object: '#EE86BE',
  string: '#E0A567',
  number: '#78B9EE',
  boolean: '#B396F0',
  timestamp: '#5FC6B4',
  opaque: '#A7A199',
  required: '#B8433A',
  recursive: '#D9B44A',
  muted: '#A7A199',
};

export function getPropertyTypePalette(isDark: boolean): PropertyTypePalette {
  return isDark ? DARK : LIGHT;
}

/** Words for each colour, so the mapping is learnable rather than decorative. */
export const CATEGORY_LABELS: Record<PropertyTypeCategory, string> = {
  object: 'object',
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  timestamp: 'timestamp',
  opaque: 'other',
};
