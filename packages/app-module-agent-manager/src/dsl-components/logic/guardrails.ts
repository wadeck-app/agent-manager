import type { GuardrailBlocksDto } from '../shared.js';
// violations-suppress: ts/no-deep-relative the window is defined once, in commons/ (shared by the backend and the page), next to the DTO
import { RECENT_BLOCK_WINDOW_MS } from '../../commons/guardrails.js';

/** Pure text helpers of the Guardrails page and of the "blocked" chip of the session rows. */

// violations-suppress: ts/no-deep-relative the module has no path alias; commons/ is shared by the backend and the page
export { remainingText } from '../../commons/remainingText.js';

/** The slash command the user runs in the session to grant a bypass himself (the module never grants one). */
export function bypassCommand(category: string, mode: string = 'once'): string {
  return `/w-guardrails:request-bypass ${category} ${mode}`;
}

/** "30 min", from the window of the backend. */
export const RECENT_WINDOW_TEXT = `${RECENT_BLOCK_WINDOW_MS / 60_000} min`;

/** "37 times on interpreter-exec" or "67 times (interpreter-exec 37, rm 30)"; `scope` (" in total", " in the last 30 min") goes after the count. */
function countText(count: number, categories: readonly { category: string; count: number }[], scope: string): string {
  const times = count === 1 ? '1 time' : `${count} times`;
  if (categories.length === 1) {
    return `${times}${scope} on ${categories[0]!.category}`;
  }
  const shown = categories.slice(0, 3).map((item) => `${item.category} ${item.count}`);
  const more = categories.length > 3 ? `, ${categories.length - 3} more` : '';
  return `${times}${scope}${categories.length === 0 ? '' : ` (${shown.join(', ')}${more})`}`;
}

/**
 * The full history, each number with its window (detail header, Permissions tab): "Blocked 37 times in total on interpreter-exec, 2 in the last 30 min",
 * "..., none in the last 30 min", or "Blocked 2 times in the last 30 min on rm" when the plugin counters hold nothing for the session.
 */
export function blockedText(blocks: GuardrailBlocksDto): string {
  if (blocks.total === 0) {
    return blocks.recent.total === 0 ? 'Blocked 0 times' : `Blocked ${countText(blocks.recent.total, blocks.recent.categories, ` in the last ${RECENT_WINDOW_TEXT}`)}`;
  }
  const recent = blocks.recent.total === 0 ? `none in the last ${RECENT_WINDOW_TEXT}` : `${blocks.recent.total} in the last ${RECENT_WINDOW_TEXT}`;
  return `Blocked ${countText(blocks.total, blocks.categories, ' in total')}, ${recent}`;
}

/** What the list badge says: only the blocks of the last 30 min ("Blocked 2 times in the last 30 min on rm"); empty when there are none (no badge). */
export function recentBlockedText(blocks: GuardrailBlocksDto): string {
  return blocks.recent.total === 0 ? '' : `Blocked ${countText(blocks.recent.total, blocks.recent.categories, ` in the last ${RECENT_WINDOW_TEXT}`)}`;
}

/** How much of a command a row shows before "Show full". */
export const COMMAND_PREVIEW = 120;

export function previewOf(text: string, full: boolean): { text: string; cut: boolean } {
  if (full || text.length <= COMMAND_PREVIEW) {
    return { text, cut: false };
  }
  return { text: `${text.slice(0, COMMAND_PREVIEW)}...`, cut: true };
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** "2026-11-21 14:05:09" in the local time zone. */
export function clockText(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** The sub-agent part of a journal session ("287760ca:A:a2a5:general-purpose" -> "general-purpose"), empty for the main agent. */
export function subagentOf(session: string): string {
  const parts = session.split(':');
  return parts[1] === 'A' ? (parts[3] ?? parts[2] ?? 'sub-agent') : '';
}
