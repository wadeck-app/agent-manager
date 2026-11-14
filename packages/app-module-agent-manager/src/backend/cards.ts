import type { SessionRow } from './present.js';

/** A DSL node, as the view renderer takes it. */
export type DslNode = Record<string, unknown>;

const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);

/**
 * The renderer treats every authored string that starts with `$` (or, after blanks, with `!`) as an expression to evaluate. The nodes below are
 * built from registry data (session names, folders), which is not authored by us: a name such as "$sources.x" must be shown, not evaluated.
 * A zero-width space in front of it is invisible and is not a blank for the renderer (no trim removes it).
 */
export function literal(text: string): string {
  return /^\s*[$!]/.test(text) ? ZERO_WIDTH_SPACE + text : text;
}

const STATUS_VARIANT = { busy: 'info', idle: 'success', other: 'warning' } as const;

const tag = (label: string): DslNode => ({ $type: 'Tag', label: literal(label) });

/**
 * The "cards" variant of the sessions page: one Card per session, as DSL nodes spliced into the page by an ExtensionSlot (the dsl-ui layout
 * nodes have no repeater: the table is the only one). Colours are the semantic variants of Badge, never fixed colours.
 */
export function sessionCard(row: SessionRow): DslNode {
  const headline: DslNode[] = [
    tag(row.displayName),
    { $type: 'Badge', label: literal(row.statusDetail), variant: STATUS_VARIANT[row.statusGroup], tone: 'subtle' },
  ];
  if (!row.alive) {
    headline.push({ $type: 'Badge', label: 'dead', variant: 'danger', tone: 'subtle' });
  }
  const facts: DslNode[] = [tag(row.folder), tag(`pid ${row.pid}`)];
  if (row.version !== undefined) {
    facts.push(tag(`Claude Code ${row.version}`));
  }
  const items: DslNode[] = [
    { $type: 'HorizontalStack', gap: 'gap-2', align: 'items-center', items: headline },
    { $type: 'HorizontalStack', gap: 'gap-2', align: 'items-center', items: facts },
  ];
  if (row.statusUpdatedAt !== undefined) {
    items.push({ $type: 'HorizontalStack', gap: 'gap-2', align: 'items-center', items: [tag('Status since'), { $type: 'DateText', value: row.statusUpdatedAt, relative: true }] });
  }
  return { $type: 'Card', padding: 'sm', items: [{ $type: 'VerticalStack', gap: 'gap-2', items }] };
}

export function sessionCards(rows: readonly SessionRow[]): DslNode[] {
  return rows.map(sessionCard);
}
