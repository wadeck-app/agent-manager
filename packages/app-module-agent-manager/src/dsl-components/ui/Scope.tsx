import type { ReactNode } from 'react';

/**
 * The class every utility of the module's stylesheet is scoped under (build-css.ts sets Tailwind's `important: '.agents-scope'`, so each rule reads
 * `.agents-scope .hidden`). The shell loads the stylesheet of EVERY module one after another and each is a full Tailwind build: unscoped, a later
 * `.hidden{display:none}` would win over our `@media{.lg\:flex{display:flex}}` (same specificity, later in the cascade). Scoped, our rules always beat theirs.
 *
 * The rule is `.agents-scope .x` (descendant), so an element carrying the class gets none of the utilities itself: it is a wrapper, `display: contents`
 * (styles/agents.css), whose children carry the classes. Every root we render and every portal container goes through this component.
 */
export const SCOPE_CLASS = 'agents-scope';

export function Scope({ children }: { children: ReactNode }) {
  return <div className={SCOPE_CLASS}>{children}</div>;
}
