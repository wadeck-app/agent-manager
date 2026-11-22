/*
 * The multi-selection of sessions: pure rules. The selection is a set of ids (agentId: the lowercase session id), kept by id so a re-sort or a poll never
 * moves it, and pruned when a session is gone.
 */

/** The ids from `from` to `to` inclusive, in the order of `visible` (either way round). A missing end gives just `to`: never a guess. */
export function rangeBetween(visible: readonly string[], from: string | undefined, to: string): string[] {
  const end = visible.indexOf(to);
  const start = from === undefined ? -1 : visible.indexOf(from);
  if (end < 0) {
    return [];
  }
  if (start < 0) {
    return [to];
  }
  return visible.slice(Math.min(start, end), Math.max(start, end) + 1);
}

/** The selection without the ids that are not in `existing`; the same set when nothing was removed (no render for nothing). */
export function pruneSelection(selected: ReadonlySet<string>, existing: ReadonlySet<string>): ReadonlySet<string> {
  let removed = false;
  const kept = new Set<string>();
  for (const id of selected) {
    if (existing.has(id)) {
      kept.add(id);
    } else {
      removed = true;
    }
  }
  return removed ? kept : selected;
}

export type GroupCheck = 'none' | 'some' | 'all';

/** What the select-all box of a group shows: none, some (indeterminate) or all of its members selected; a group with no member is 'none'. */
export function groupCheck(ids: readonly string[], selected: ReadonlySet<string>): GroupCheck {
  if (ids.length === 0) {
    return 'none';
  }
  const count = ids.filter((id) => selected.has(id)).length;
  return count === 0 ? 'none' : count === ids.length ? 'all' : 'some';
}

/** "3 selected". */
export function selectedText(count: number): string {
  return `${count} selected`;
}
