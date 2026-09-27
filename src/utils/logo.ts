import logoSvg from '../assets/logo.svg?raw';

// The logo's strokes, for the animations that slide each one into its own
// mask (the site-entry loader, Layout.astro; the page transition,
// PageTransition.astro). Computed at build time, so the masks are in the
// HTML from the first paint.
//
// The logo's two angles (measured from logo.svg's first stroke): AXIS is
// the strokes' long diagonal - each slides along it, in and out of a mask
// cut to its own shape. Assumes logo.svg's paths use absolute coordinates
// only (as Figma exports them).
const unit = (x: number, y: number) => {
  const len = Math.hypot(x, y);
  return { x: x / len, y: y / len };
};
const AXIS = unit(37, -55);
const r2 = (n: number) => Math.round(n * 100) / 100;

export const logoViewBox = logoSvg.match(/viewBox="([^"]+)"/)?.[1] ?? '0 0 70 71';

// `travel`: how far a stroke slides along AXIS to clear its mask entirely.
export const logoStrokes = [...logoSvg.matchAll(/\sd="([^"]+)"/g)].map(([, d]) => {
  const nums = (d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
  let min = Infinity,
    max = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const along = nums[i] * AXIS.x + nums[i + 1] * AXIS.y;
    min = Math.min(min, along);
    max = Math.max(max, along);
  }
  // +2: 1-unit margin each end so antialiased edges are never clipped.
  const travel = max - min + 2;
  return { d, travel: { x: r2(AXIS.x * travel), y: r2(AXIS.y * travel) } };
});

// The homepage reel's column count (5 / 3 / 2, see ProjectsReel.astro) -
// all 5 columns/lines are rendered, CSS hides the extra ones per breakpoint.
export const GRID_COLS = 5;
