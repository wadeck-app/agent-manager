export type ListKind = 'groups' | 'inbox' | 'tree' | 'tabs-cards' | 'palette';

/** The sub-variants (style) of each list. The first one is the default of the list. The AbTest hints in sessions-page.yaml say what each one changes. */
export const LIST_STYLES: Record<ListKind, readonly string[]> = {
  groups: ['comfortable', 'compact', 'preview'],
  inbox: ['tabs', 'segmented', 'autonext'],
  tree: ['expanded', 'attention', 'rollup'],
  'tabs-cards': ['cards', 'rail', 'harness'],
  palette: ['search', 'facets', 'minimal'],
};

export type VariantProblem = { ok: true; list: ListKind; style: string } | { ok: false; text: string };

/** Checks the two props of the component. A wrong value is an authoring mistake in the YAML: it is reported on the page, never replaced by a default. */
export function checkVariant(list: unknown, style: unknown): VariantProblem {
  const kinds = Object.keys(LIST_STYLES);
  if (typeof list !== 'string' || !kinds.includes(list)) {
    return { ok: false, text: `AgentWorkspace: list is ${JSON.stringify(list)}. Use one of: ${kinds.join(', ')}.` };
  }
  const kind = list as ListKind;
  const styles = LIST_STYLES[kind];
  if (typeof style !== 'string' || !styles.includes(style)) {
    return { ok: false, text: `AgentWorkspace: variant is ${JSON.stringify(style)} for the list '${kind}'. Use one of: ${styles.join(', ')}.` };
  }
  return { ok: true, list: kind, style };
}

/** The styles of the log in the detail pane (A/B test `detail-log-style`). The first one is the default. */
export const LOG_STYLES = ['chat', 'timeline', 'compact'] as const;
export type LogStyle = (typeof LOG_STYLES)[number];
