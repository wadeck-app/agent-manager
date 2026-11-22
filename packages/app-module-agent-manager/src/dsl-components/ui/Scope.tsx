import type { ReactNode } from 'react';
import { useDensity } from './density.js';
import { useUiVariant } from './UiVariants.js';

/**
 * The class every utility of the module's stylesheet is scoped under (build-css.ts sets Tailwind's `important: '.agents-scope'`, so each rule reads
 * `.agents-scope .hidden`). The shell loads the stylesheet of EVERY module one after another and each is a full Tailwind build: unscoped, a later
 * `.hidden{display:none}` would win over our `@media{.lg\:flex{display:flex}}` (same specificity, later in the cascade). Scoped, our rules always beat theirs.
 *
 * The rule is `.agents-scope .x` (descendant), so an element carrying the class gets none of the utilities itself: it is a wrapper, `display: contents`
 * (styles/agents.css), whose children carry the classes. Every root we render and every portal container goes through this component.
 *
 * The wrapper also carries the density setting (`data-density`): the type and icon scale is a set of CSS variables per value, so the setting
 * needs no class on any element below. The Font A/B question sets `data-font` (absent for the app font; styles/agents.css), read from the UiVariants above: the page puts UiVariants OUTSIDE its Scope, and a dialog or tooltip portal, rendered inside the React tree, sees it too.
 */
export const SCOPE_CLASS = 'agents-scope';

export function Scope({ children }: { children: ReactNode }) {
  const density = useDensity();
  const font = useUiVariant('font');
  return (
    <div className={SCOPE_CLASS} data-density={density} data-font={font === 'app' ? undefined : font}>
      {children}
    </div>
  );
}
