import { type AgentEntry, type AgentGroup, type AgentState } from './agentState.js';
import { type DslNode, literal } from './cards.js';
import { compactDuration } from './compactDuration.js';
import type { SessionRow } from './present.js';

// Non-ASCII glyphs are written as escapes: the sources of this repository are ASCII only.
const DOT = String.fromCharCode(0x25cf);
const RING = String.fromCharCode(0x25cb);

/**
 * Every ASCII punctuation character of a registry string is backslash-escaped for the Markdown node, so that a session named "**x**", "[a](b)" or
 * "http://x" is shown as typed, not as bold, a link or an autolink. Line breaks become spaces (a heading is one line).
 */
export function markdownText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/[!-/:-@[-`{-~]/g, (char) => `\\${char}`);
}

/** Folder in bold (a level 3 heading is the one bold text style of the Markdown node), session name muted (a level 6 heading is muted). */
const folderText = (folder: string): DslNode => ({ $type: 'Markdown', text: literal(`### ${markdownText(folder)}`) });
const nameText = (name: string): DslNode => ({ $type: 'Markdown', text: literal(`###### ${markdownText(name)}`) });

interface StateLook {
  /** What the icon says for assistive technology and the tooltip. */
  title: string;
  icon: DslNode;
}

/** The status icon of a state: a red "!" badge, a blue dot, a spinner, a hollow circle (semantic variants only, never a colour). */
function lookOf(state: AgentState, detail: string): StateLook {
  switch (state) {
    case 'needs-you':
      return { title: `Needs you (${detail})`, icon: { $type: 'Badge', label: '!', variant: 'danger', tone: 'solid', size: 'sm' } };
    case 'done':
      return { title: 'Done, not seen yet', icon: { $type: 'Badge', label: DOT, variant: 'info', tone: 'subtle', size: 'sm' } };
    case 'working':
      return { title: `Working (${detail})`, icon: { $type: 'Spinner', size: 'sm' } };
    case 'idle':
      return { title: 'Idle', icon: { $type: 'Badge', label: RING, variant: 'default', tone: 'subtle', size: 'sm' } };
    case 'ended':
      return { title: 'Ended: the process is gone', icon: { $type: 'Badge', label: 'x', variant: 'default', tone: 'subtle', size: 'sm' } };
    case 'other':
      return { title: `Other status: ${detail}`, icon: { $type: 'Badge', label: '?', variant: 'warning', tone: 'subtle', size: 'sm' } };
    default:
      throw new Error(`Unhandled agent state ${String(state)}`);
  }
}

const iconButton = (action: string, label: string, icon: string, sessionId: string, body?: Record<string, unknown>): DslNode => ({
  $type: 'ActionButton',
  action,
  label,
  icon,
  iconOnly: true,
  variant: 'ghost',
  size: 'sm',
  params: { sessionId },
  ...(body === undefined ? {} : { body }),
});

/** The ISO text of an epoch ms, or undefined when it is not a usable time (undefined, NaN, Infinity, negative, beyond the Date range 8.64e15). Never throws. */
function isoOrUndefined(epochMs: number | undefined): string | undefined {
  if (epochMs === undefined || !Number.isFinite(epochMs) || epochMs < 0 || epochMs > 8.64e15) {
    return undefined;
  }
  return new Date(epochMs).toISOString();
}

/** One row of the panel: harness, folder (bold), session name (muted) on the left; time in state, status icon, actions on the right. */
export function herdrRow(entry: AgentEntry, row: SessionRow, now: number): DslNode {
  const { session, state, pinned } = entry;
  const look = lookOf(state, row.statusDetail);
  const iso = isoOrUndefined(session.statusUpdatedAt);
  // A present but unusable timestamp (NaN, negative, beyond the Date range): the time shows "?" and the row carries a visible marker, never a failing panel.
  const invalidTime = session.statusUpdatedAt !== undefined && iso === undefined;
  const age = iso === undefined || session.statusUpdatedAt === undefined ? undefined : now - session.statusUpdatedAt;
  const left: DslNode[] = [{ $type: 'Badge', label: 'CC', variant: row.harnessVariant, tone: 'subtle', size: 'sm' }, folderText(session.folder)];
  if (session.name !== undefined && session.name !== session.folder) {
    left.push(nameText(session.name));
  }
  const since = invalidTime
    ? `an invalid time (statusUpdatedAt is ${String(session.statusUpdatedAt)} in the registry, not a usable epoch in milliseconds)`
    : (iso ?? 'an unknown time (the registry has no statusUpdatedAt)');
  const right: DslNode[] = [
    { $type: 'Tooltip', content: `State since ${since}`, items: [nameText(compactDuration(age))] },
    { $type: 'Tooltip', content: look.title, items: [look.icon] },
  ];
  if (invalidTime) {
    right.unshift({ $type: 'Tooltip', content: `Invalid statusUpdatedAt in the registry (${String(session.statusUpdatedAt)}): the time in state is unknown`, items: [{ $type: 'Badge', label: 'bad time', variant: 'warning', tone: 'subtle', size: 'sm' }] });
  }
  if (state === 'done') {
    right.push(iconButton('markSeen', 'Mark seen: the session goes back to Idle', 'check', session.sessionId));
  }
  right.push(pinned ? iconButton('pinSession', 'Unpin this session', 'x', session.sessionId, { pinned: false }) : iconButton('pinSession', 'Pin this session', 'plus', session.sessionId, { pinned: true }));
  return {
    $type: 'HorizontalStack',
    gap: 'gap-2',
    align: 'items-center',
    justify: 'justify-between',
    items: [
      { $type: 'HorizontalStack', gap: 'gap-2', align: 'items-center', items: left },
      { $type: 'HorizontalStack', gap: 'gap-1.5', align: 'items-center', items: right },
    ],
  };
}

/** One group: a Collapsible whose title is the label and the count, open by default, holding the rows. */
export function herdrGroup(group: AgentGroup, rows: ReadonlyMap<string, SessionRow>, now: number): DslNode {
  return {
    $type: 'Collapsible',
    title: `${group.label} ${group.entries.length}`,
    defaultOpen: true,
    items: group.entries.map((entry) => herdrRow(entry, rows.get(entry.session.file) as SessionRow, now)),
  };
}

export function herdrGroups(groups: readonly AgentGroup[], rows: readonly SessionRow[], now: number): DslNode[] {
  const byFile = new Map(rows.map((row) => [row.file, row]));
  return groups.map((group) => herdrGroup(group, byFile, now));
}
