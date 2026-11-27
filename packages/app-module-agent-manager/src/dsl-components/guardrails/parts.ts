/** Class strings shared by the sections of the Guardrails page (plain tables, no UPPERCASE headings, density variables only). */

export const TH = 'whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-muted';
export const TD = 'px-3 py-2 align-top text-sm text-content';
export const MONO = 'font-mono text-am-mono';
export const FIELD = 'h-am-hit rounded border border-border bg-bg px-2 text-sm text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';
/** A cell of a short value (a category, a mode, a time left, a count): one line, so it never wraps while the free text column next to it has room. */
export const TD_SHORT = `${TD} whitespace-nowrap`;
