import type { GuardrailBlocksDto } from '../shared.js';

/** Pure text helpers of the Guardrails page and of the "blocked" chip of the session rows. */

/** "42 s", "29 min", "1 h 05 min": the time left of a grant. */
export function remainingText(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return 'expired';
  }
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) {
    return `${seconds} s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, '0')} min`;
}

/** The slash command the user runs in the session to grant a bypass himself (the module never grants one). */
export function bypassCommand(category: string, mode: string = 'once'): string {
  return `/w-guardrails:request-bypass ${category} ${mode}`;
}

/** "Blocked 37 times on interpreter-exec" or "Blocked 67 times (interpreter-exec 37, rm 30)". */
export function blockedText(blocks: GuardrailBlocksDto): string {
  const times = blocks.total === 1 ? '1 time' : `${blocks.total} times`;
  if (blocks.categories.length === 1) {
    return `Blocked ${times} on ${blocks.categories[0]!.category}`;
  }
  const shown = blocks.categories.slice(0, 3).map((item) => `${item.category} ${item.count}`);
  const more = blocks.categories.length > 3 ? `, ${blocks.categories.length - 3} more` : '';
  return `Blocked ${times} (${shown.join(', ')}${more})`;
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
