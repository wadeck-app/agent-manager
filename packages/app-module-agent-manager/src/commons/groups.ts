// The contract of the custom groups (user-defined groups of agents) shared by the backend and the UI: limits, colors, name rule, and the one pure
// function that decides where a member goes in a group (both sides must agree on it, so the optimistic list and the saved one match).

/** The colors a group can take (names, not CSS: the UI maps them to the theme). `null` means no color. */
export const GROUP_COLORS = ['blue', 'green', 'yellow', 'orange', 'red', 'purple', 'cyan', 'gray'] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

export const GROUP_NAME_MAX = 60;

/** A member whose session has been missing from the registry for longer than this is dropped from its group (one missing read, a restart or a rewritten file never is). */
export const GROUP_ABSENT_PRUNE_MS = 14 * 24 * 60 * 60 * 1000;

/** Upper bound of the groups: a file that grows without limit is a bug or an abuse, and says so. */
export const MAX_GROUPS = 50;

// Control characters (C0, DEL, C1) are refused: they break the list and the terminal output of the CLI.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

/** The trimmed name, or why it is refused (a sentence the user can act on). */
export function checkGroupName(value: unknown): { ok: true; name: string } | { ok: false; text: string } {
  if (typeof value !== 'string') {
    return { ok: false, text: `The group name must be text, got ${value === undefined ? 'nothing' : JSON.stringify(value)}` };
  }
  const name = value.trim();
  if (name.length === 0) {
    return { ok: false, text: 'The group name is empty: type 1 to 60 characters' };
  }
  if (name.length > GROUP_NAME_MAX) {
    return { ok: false, text: `The group name has ${name.length} characters: the limit is ${GROUP_NAME_MAX}` };
  }
  if (CONTROL.test(name)) {
    return { ok: false, text: 'The group name contains a control character (a tab, a line break...): use plain text' };
  }
  return { ok: true, name };
}

export function isGroupColor(value: unknown): value is GroupColor {
  return typeof value === 'string' && (GROUP_COLORS as readonly string[]).includes(value);
}

/**
 * `id` placed in `members` before `beforeId` (at the end when `beforeId` is null or absent), removed from its previous position first.
 * Returns undefined when `beforeId` is not a member (or is `id` itself): the caller says so, a move to an unknown position is never guessed.
 */
export function placeMember(members: readonly string[], id: string, beforeId: string | null | undefined): string[] | undefined {
  const rest = members.filter((member) => member !== id);
  if (beforeId === null || beforeId === undefined) {
    return [...rest, id];
  }
  const at = rest.indexOf(beforeId);
  if (at < 0) {
    return undefined;
  }
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

/** How the agents of a group are ordered (the Custom mode): by hand (drag and drop), most urgent first, by name, or by the latest change. */
export const GROUP_SORTS = ['manual', 'urgency', 'name', 'recent'] as const;
export type GroupSort = (typeof GROUP_SORTS)[number];

export function isGroupSort(value: unknown): value is GroupSort {
  return typeof value === 'string' && (GROUP_SORTS as readonly string[]).includes(value);
}

/** The marks of a session in the Custom mode: a flag (kept until removed) and "unread" (cleared when the agent is selected). `at`: epoch ms of the last change, the clock of the absence prune. */
export interface SessionMarks {
  flag: boolean;
  unread: boolean;
  at: number;
}
