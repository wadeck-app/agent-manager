/**
 * The options of each mode (the "View options" popover), remembered per mode in localStorage. Every option has a default; a stored value that is not valid is
 * replaced by the default of that option only (the other options keep theirs).
 */
export type TreeGrouping = 'workspace' | 'none';
export type TreeExpansion = 'all' | 'attention';

export interface ViewOptions {
  tree: { grouping: TreeGrouping; expansion: TreeExpansion };
  groups: { preview: boolean };
  inbox: { autoNext: boolean };
}

export const DEFAULT_VIEW_OPTIONS: ViewOptions = {
  tree: { grouping: 'workspace', expansion: 'all' },
  groups: { preview: true },
  inbox: { autoNext: false },
};

export const VIEW_OPTIONS_STORAGE_KEY = 'agent-manager.viewOptions';

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
}

/** Reads the options from the stored JSON text (null when nothing is stored). Invalid parts fall back to their defaults. */
export function parseViewOptions(text: string | null): ViewOptions {
  let stored: Record<string, unknown> = {};
  if (text !== null) {
    try {
      stored = record(JSON.parse(text));
    } catch {
      stored = {};
    }
  }
  const tree = record(stored['tree']);
  const groups = record(stored['groups']);
  const inbox = record(stored['inbox']);
  return {
    tree: {
      grouping: pick(tree['grouping'], ['workspace', 'none'], DEFAULT_VIEW_OPTIONS.tree.grouping),
      expansion: pick(tree['expansion'], ['all', 'attention'], DEFAULT_VIEW_OPTIONS.tree.expansion),
    },
    groups: { preview: typeof groups['preview'] === 'boolean' ? groups['preview'] : DEFAULT_VIEW_OPTIONS.groups.preview },
    inbox: { autoNext: typeof inbox['autoNext'] === 'boolean' ? inbox['autoNext'] : DEFAULT_VIEW_OPTIONS.inbox.autoNext },
  };
}

/** The saved options. A storage that throws (private mode) means "nothing saved". */
export function readViewOptions(): ViewOptions {
  try {
    return parseViewOptions(window.localStorage.getItem(VIEW_OPTIONS_STORAGE_KEY));
  } catch {
    return parseViewOptions(null);
  }
}

export function saveViewOptions(options: ViewOptions): void {
  try {
    window.localStorage.setItem(VIEW_OPTIONS_STORAGE_KEY, JSON.stringify(options));
  } catch {
    // Not saved: the options reset on reload. Nothing the user could fix, nothing worth an error banner.
  }
}
