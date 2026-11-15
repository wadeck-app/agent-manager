import { AUTO_L_FROM_PX, AUTO_ML_FROM_PX, type Density } from './density.js';

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
  /** Width of the sub-agent panel (it grows with the text) and the widest column of log rows. */
  aside: number;
  logMax: number;
}

/**
 * The one table of the sizes per density. The popover hints are written from it (DensityControl), and a test (build/scopedCss.test.ts) checks that the built
 * stylesheet (styles/agents.css, the \`--am-*\` variables) holds exactly these numbers, so the words the user reads and the sizes the page uses cannot drift apart.
 */
export const DENSITY_SCALE: Record<Density, DensityScale> = {
  s: { fsXs: 12, fsSm: 14, fsBase: 16, fsMono: 13, icon: 18, iconSm: 14, dot: 8, hit: 32, row: 44, aside: 300, logMax: 1100 },
  m: { fsXs: 13, fsSm: 15, fsBase: 16, fsMono: 14, icon: 20, iconSm: 16, dot: 10, hit: 36, row: 52, aside: 340, logMax: 1152 },
  ml: { fsXs: 13, fsSm: 16, fsBase: 17, fsMono: 15, icon: 22, iconSm: 17, dot: 11, hit: 38, row: 56, aside: 400, logMax: 1260 },
  l: { fsXs: 14, fsSm: 17, fsBase: 18, fsMono: 16, icon: 24, iconSm: 18, dot: 12, hit: 40, row: 60, aside: 460, logMax: 1400 },
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
  aside: '--am-aside',
  logMax: '--am-log-max',
};

/** The hint of a density in the popover: the same three facts for each. */
export function densityHint(density: Density): string {
  const scale = DENSITY_SCALE[density];
  return `${scale.fsSm} px text, ${scale.icon} px icons, rows from ${scale.row} px`;
}

/** The hint of the `auto` choice: what it does, with the thresholds of density.ts. */
export function autoHint(): string {
  return `Follows the window: Medium plus from ${AUTO_ML_FROM_PX} px wide, Large from ${AUTO_L_FROM_PX} px`;
}
