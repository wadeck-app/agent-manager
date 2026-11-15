/** A DSL node, as the view renderer takes it. */
export type DslNode = Record<string, unknown>;

const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

/**
 * The renderer treats every authored string that starts with `$` (or, after blanks, with `!`) as an expression to evaluate. The nodes built by
 * the routes come from registry data (session names, folders), which is not authored by us: a name such as "$sources.x" must be shown, not
 * evaluated. A zero-width space in front of it is invisible and is not a blank for the renderer (no trim removes it).
 */
export function literal(text: string): string {
  return /^\s*[$!]/.test(text) ? ZERO_WIDTH_SPACE + text : text;
}
