import type { Config } from 'tailwindcss';
// @ts-expect-error - plain JS preset shipped by dsl-ui, no type declarations
import dslUiPreset, { dslUiContent } from '@wadeck-app/dsl-ui/tailwind-preset';

/**
 * Tailwind config of the module's stylesheet (scripts/build-css.ts sets the content globs to absolute paths).
 * The preset owns the colour mapping (semantic tokens, hue tokens) and the dark-mode selector.
 *
 * The type and icon scale of the page is driven by CSS variables set per density (styles/agents.css: `.agents-scope[data-density='s'|'m'|'l']`), so
 * the user's S / M / L setting resizes everything with no class change: `text-xs`, `text-sm` and `text-base` are redefined here to read the variables
 * (inside the scope only: the module stylesheet is scoped under `.agents-scope`), and the tokens below name the roles that have no Tailwind step.
 */
export default {
  presets: [dslUiPreset],
  content: [
    './src/**/*.{ts,tsx}',
    // Required: Tailwind reads `content` from the top-level config only, so the preset cannot contribute scan paths.
    ...(dslUiContent as string[]),
  ],
  theme: {
    extend: {
      fontSize: {
        // Secondary text, timestamps, counts (never below 12 px).
        xs: ['var(--am-fs-xs)', { lineHeight: 'var(--am-lh-xs)' }],
        // Row titles, log prose, buttons.
        sm: ['var(--am-fs-sm)', { lineHeight: 'var(--am-lh-sm)' }],
        // Titles and the reply box (16 px or more: no zoom on touch screens).
        base: ['var(--am-fs-base)', { lineHeight: 'var(--am-lh-base)' }],
        // Tool lines and tool output (monospace).
        'am-mono': ['var(--am-fs-mono)', { lineHeight: 'var(--am-lh-mono)' }],
      },
      lineHeight: {
        // Reading line height of the log prose.
        'am-log': 'var(--am-lh-log)',
      },
      spacing: {
        // Icon of a row (state), icon next to text, a comfortable hit target, the height of one list row.
        'am-icon': 'var(--am-icon)',
        'am-icon-sm': 'var(--am-icon-sm)',
        'am-dot': 'var(--am-dot)',
        'am-hit': 'var(--am-hit)',
        'am-row': 'var(--am-row)',
        // The sub-agent panel grows with the text.
        'am-aside': 'var(--am-aside)',
      },
      maxWidth: {
        // Comfortable measure of prose (about 100 characters).
        'am-prose': 'min(92%, 104ch)',
        // The column of the log rows on a very wide pane: a time stays within reach of its label (1152 px at M, up to 1400 px at L).
        'am-log': 'var(--am-log-max)',
      },
    },
  },
  plugins: [],
} satisfies Config;
