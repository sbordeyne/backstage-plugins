/**
 * Chart fills are deliberately NOT `theme.palette.success.main` / `error.main`.
 * Those theme colours fail as chart marks: the green scores 2.01:1 against the
 * light surface (needs 3:1) and the green/red pair sits at deutan ΔE 8.4, right
 * on the colour-blindness floor.
 *
 * The values below were computed with the dataviz palette validator and pass the
 * lightness band, CVD separation, normal-vision floor and contrast checks in both
 * modes. Re-run it if either app theme changes:
 *
 *   node scripts/validate_palette.js "#43A047,#A31515,#8A8580" --mode light --surface "#FBF8F1"
 *   node scripts/validate_palette.js "#51AB59,#B8433A,#8F8A82" --mode dark  --surface "#1E1D1B"
 *
 * The one flagged check is the chroma floor on the grey, which is intentional:
 * "skipped" is a neutral status, not a categorical hue.
 */
export interface ChartPalette {
  surface: string;
  passed: string;
  failed: string;
  skipped: string;
  axis: string;
  label: string;
}

const LIGHT: ChartPalette = {
  // The light theme's own paper colour; marks reach 3:1 against it.
  surface: '#FBF8F1',
  passed: '#43A047',
  failed: '#A31515',
  skipped: '#8A8580',
  axis: '#C9C3B8',
  label: '#4A4640',
};

/**
 * The dark theme's `background.paper` is #767470 — a *mid* grey that sits inside
 * the very lightness band chart marks occupy, so nothing can reach 3:1 against
 * it. The chart therefore paints its own darker panel.
 */
const DARK: ChartPalette = {
  surface: '#1E1D1B',
  passed: '#51AB59',
  failed: '#B8433A',
  skipped: '#8F8A82',
  axis: '#4A4740',
  label: '#D8D3CA',
};

export function getChartPalette(isDark: boolean): ChartPalette {
  return isDark ? DARK : LIGHT;
}
