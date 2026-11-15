import type { Density } from './density.js';

/** What one density sets, in pixels (line heights are in `--am-lh-*`, only in the stylesheet). */
export interface DensityScale {
  fsXs: number;
  fsSm: number;
  fsBase: number;
  fsMono: number;
  icon: number;
  iconSm: number;
  dot: number;
  hit: number;
  row: number;
}

/**
 * The one table of the sizes per density. The popover hints are written from it (DensityControl), and a test (build/scopedCss.test.ts) checks that the built
 * stylesheet (styles/agents.css, the \`--am-*\` variables) holds exactly these numbers, so the words the user reads and the sizes the page uses cannot drift apart.
 */
export const DENSITY_SCALE: Record<Density, DensityScale> = {
  s: { fsXs: 12, fsSm: 14, fsBase: 16, fsMono: 13, icon: 18, iconSm: 14, dot: 8, hit: 32, row: 44 },
  m: { fsXs: 13, fsSm: 15, fsBase: 16, fsMono: 14, icon: 20, iconSm: 16, dot: 10, hit: 36, row: 52 },
  l: { fsXs: 14, fsSm: 17, fsBase: 18, fsMono: 16, icon: 24, iconSm: 18, dot: 12, hit: 40, row: 60 },
};

/** The CSS variable of each field of the table. */
export const SCALE_VARIABLES: Record<keyof DensityScale, string> = {
  fsXs: '--am-fs-xs',
  fsSm: '--am-fs-sm',
  fsBase: '--am-fs-base',
  fsMono: '--am-fs-mono',
  icon: '--am-icon',
  iconSm: '--am-icon-sm',
  dot: '--am-dot',
  hit: '--am-hit',
  row: '--am-row',
};

/** The hint of a density in the popover: the same three facts for each. */
export function densityHint(density: Density): string {
  const scale = DENSITY_SCALE[density];
  return `${scale.fsSm} px text, ${scale.icon} px icons, rows from ${scale.row} px`;
}
