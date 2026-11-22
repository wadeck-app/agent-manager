export type NoticeTone = 'error' | 'warning' | 'info';

/** The longest one-line sentence of a notice (the full text goes to the Details disclosure). */
export const SUMMARY_MAX = 70;

export interface NoticeItem {
  /** Stable id of the problem kind (React key). The dismissal is remembered by `details`, not by this key, so a changed text shows again. */
  key: string;
  tone: NoticeTone;
  /** One short sentence (<= SUMMARY_MAX characters). */
  summary: string;
  /** The full message: why, which file, what to do. Shown by the Details disclosure and used as the identity of a dismissal. */
  details: string;
  /** A command the user can run to fix it: the Copy fix button copies it. */
  fix?: string;
  /** Another button of the line ("Remove it from the address"). */
  action?: { label: string; run: () => void };
  /** A notice of the page itself (a refused action, a search note): dismissing it clears that state instead of being remembered by the browser session. */
  onDismiss?: () => void;
}

export const DISMISSED_KEY = 'agent-manager.dismissedNotices';

/** The first command between backticks of a message ("Fix: run `agent-manager start --detach`"), undefined when there is none. */
export function fixOf(text: string): string | undefined {
  return /`([^`]+)`/.exec(text)?.[1];
}

/** The messages dismissed in this browser session. A storage that cannot be read means nothing is dismissed: a notice is never hidden by accident. */
export function readDismissed(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.sessionStorage.getItem(DISMISSED_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

export function isDismissed(item: NoticeItem, dismissed: readonly string[]): boolean {
  return item.onDismiss === undefined && dismissed.includes(item.details);
}

/** Remembers the dismissal for this browser session only. A storage that refuses means it comes back at the next poll: said by nothing, it is the safe side. */
export function dismissNotice(item: NoticeItem): void {
  try {
    const next = [...readDismissed().filter((entry) => entry !== item.details), item.details];
    window.sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
  } catch {
    // Not remembered: the notice shows again, which is the safe side.
  }
}

/** Brings every dismissed notice back (the badge of the toolbar). */
export function restoreNotices(): void {
  try {
    window.sessionStorage.removeItem(DISMISSED_KEY);
  } catch {
    // Nothing was remembered in the first place.
  }
}

function clip(text: string): string {
  return text.length <= SUMMARY_MAX ? text : `${text.slice(0, SUMMARY_MAX - 3)}...`;
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

function make(key: string, tone: NoticeTone, summary: string, details: string): NoticeItem {
  const fix = fixOf(details);
  return { key, tone, summary: clip(summary), details, ...(fix === undefined ? {} : { fix }) };
}

function unreadableSummary(text: string): string {
  const count = /^(\d+) registry file/.exec(text)?.[1];
  return count === undefined ? 'Registry files unreadable' : `${plural(Number(count), 'registry file', 'registry files')} unreadable`;
}

function ownedDownSummary(text: string): string {
  const count = /^(\d+) owned session/.exec(text)?.[1];
  const noun = count === undefined ? 'owned sessions' : plural(Number(count), 'owned session', 'owned sessions');
  return `${text.includes('daemon is not running') ? 'Daemon off' : 'Daemon not answering'}: ${noun} unavailable`;
}

export interface WorkspaceNoticeTexts {
  ownedDownText: string;
  ownedStateErrorText: string;
  unreadableText: string;
  guardrailsErrorText: string;
  userStateError: string;
}

/** The persistent problems of the Agents workspace, one short notice each (the full text stays in `details`). Empty texts say nothing. */
export function workspaceNotices(texts: WorkspaceNoticeTexts): NoticeItem[] {
  const items: NoticeItem[] = [];
  if (texts.ownedDownText !== '') {
    items.push(make('owned-down', 'warning', ownedDownSummary(texts.ownedDownText), texts.ownedDownText));
  }
  if (texts.ownedStateErrorText !== '') {
    items.push(make('owned-state', 'warning', 'Owned sessions file unusable', texts.ownedStateErrorText));
  }
  if (texts.unreadableText !== '') {
    items.push(make('unreadable', 'warning', unreadableSummary(texts.unreadableText), texts.unreadableText));
  }
  if (texts.guardrailsErrorText !== '') {
    items.push(make('guardrails', 'warning', 'Guardrail counters unreadable', texts.guardrailsErrorText));
  }
  if (texts.userStateError !== '') {
    items.push(make('user-state', 'warning', 'Pins and seen markers unavailable', texts.userStateError));
  }
  return items;
}

/** The Table page (and the Agents page above its workspace): the registry could not be listed, or some of its files could not be read. */
export function registryNotices(texts: { errorText: string; unreadableText: string }): NoticeItem[] {
  const items: NoticeItem[] = [];
  if (texts.errorText !== '') {
    items.push(make('registry-error', 'error', 'Sessions cannot be listed', texts.errorText));
  }
  if (texts.unreadableText !== '') {
    items.push(make('unreadable', 'warning', unreadableSummary(texts.unreadableText), texts.unreadableText));
  }
  return items;
}

export interface GuardrailProblem {
  file: string;
  message: string;
  hint: string;
}

/** The Guardrails page: the overview error, the kill switch that cannot be read, one notice per file that cannot be used (the file path is in the details). */
export function guardrailsNotices(input: { errorText: string; killSwitchError: string; problems: readonly GuardrailProblem[] }): NoticeItem[] {
  const items: NoticeItem[] = [];
  if (input.errorText !== '') {
    items.push(make('overview-error', 'error', 'Guardrails overview unavailable', input.errorText));
  }
  if (input.killSwitchError !== '') {
    items.push(make('kill-switch', 'error', 'Kill switch state unreadable', input.killSwitchError));
  }
  input.problems.forEach((problem, index) => {
    const name = problem.file.split(/[\\/]/).filter((part) => part !== '').pop() ?? problem.file;
    items.push(make(`problem-${index}`, 'warning', `${name}: ${problem.message}`, `${problem.file} ${problem.message}. ${problem.hint}`));
  });
  return items;
}

/** The short sentence of a refused action ("Could not pin the session: <why>"): what failed, without the server's long reason. */
export function actionSummary(message: string): string {
  const cut = message.indexOf(': ');
  return clip(cut > 0 ? message.slice(0, cut) : message);
}
