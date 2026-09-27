import { palettes } from '../../domain/theme.mjs';

// Light/dark defaults plus warm, cool and strongly tinted surfaces. All 180
// palettes still run through the numerical contrast contracts on every run.
const representative = new Set(['light', 'dark', 'sandstone', 'midnight', 'coast', 'lilac', 'ember', 'aurora']);
export const capturePalette = id => representative.has(id);
export const paletteArtifacts = feature => `artifacts/${process.env.FREELANCER_ALL_PALETTES === '1' ? 'themes/' : process.env.FREELANCER_TEST_UI === '1' ? 'interactive/' : ''}${feature}`;
export const browserPalettes = process.env.FREELANCER_ALL_PALETTES === '1'
  ? palettes : palettes.filter(palette => representative.has(palette.id));
