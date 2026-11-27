import { MAX_BATCH_GRANT_SESSIONS, MAX_BATCH_REVOKE_ITEMS, type BatchGrantResult, type BatchGrantStatus, type BatchRevokeResult, type BatchRevokeStatus, type CliGrantDto, type GrantModeDto, type RuleCategoryDto } from '../shared.js';
import { addableCategories, modeWords } from '../logic/grantForm.js';

/*
 * The rules of the batch Add bypass and Remove bypass dialogs (threat-model T-24): which categories to offer, what the button says, how the results read. Pure.
 */

export { MAX_BATCH_GRANT_SESSIONS, MAX_BATCH_REVOKE_ITEMS };

/** The categories that a bypass can lift in EVERY list (one list per distinct folder), in the order and with the decision of the first list. */
export function commonCategories(lists: readonly (readonly RuleCategoryDto[])[]): RuleCategoryDto[] {
  const [first, ...others] = lists;
  if (first === undefined) {
    return [];
  }
  const everywhere = others.map((list) => new Set(addableCategories(list).map((rule) => rule.name)));
  return addableCategories(first).filter((rule) => everywhere.every((names) => names.has(rule.name)));
}

export const sessionsOf = (count: number): string => (count === 1 ? '1 session' : `${count} sessions`);
export const bypassesOf = (count: number): string => (count === 1 ? '1 bypass' : `${count} bypasses`);

/** "Allow rm once in 3 sessions", "Allow git-push for 30 min in 1 session". */
export function grantConfirmLine(category: string, mode: GrantModeDto, count: number): string {
  return `Allow ${category} ${mode === 'once' ? '' : 'for '}${modeWords(mode)} in ${sessionsOf(count)}`;
}

export interface GrantBlockInput {
  count: number;
  category: string;
  /** What `rationaleProblem` says of the reason: '' when it is fine. */
  reasonProblem: string;
  /** The rules are still being read. */
  loading: boolean;
}

/** Why the Add bypass button is off, in words; empty when the batch can be sent. */
export function grantBlockText({ count, category, reasonProblem, loading }: GrantBlockInput): string {
  if (count === 0) {
    return 'Select at least one session.';
  }
  if (count > MAX_BATCH_GRANT_SESSIONS) {
    return `A batch has at most ${MAX_BATCH_GRANT_SESSIONS} sessions: untick ${count - MAX_BATCH_GRANT_SESSIONS}, then do the rest in a second batch.`;
  }
  if (loading) {
    return 'Reading the categories from the plugin...';
  }
  if (category === '') {
    return 'No category can be bypassed in every selected folder: select fewer sessions, or sessions of folders with the same rules.';
  }
  return reasonProblem;
}

const STATUS_ORDER: BatchGrantStatus[] = ['granted', 'refused', 'failed', 'not-attempted'];

/** "2 granted, 1 refused, 1 not attempted". */
export function grantSummaryText(results: readonly BatchGrantResult[]): string {
  return STATUS_ORDER.flatMap((status) => {
    const count = results.filter((result) => result.status === status).length;
    return count === 0 ? [] : [`${count} ${status.replace('-', ' ')}`];
  }).join(', ');
}

/** The codes of the PIN token: a session that failed on them was granted nothing and may be retried once the PIN is entered again. */
const TOKEN_CODES = ['pin-expired', 'pin-not-set'];

/** The sessions a second batch may retry: the not-attempted ones, and those that failed because the PIN token expired. Never a refusal. */
export function retryableGrantIds(results: readonly BatchGrantResult[]): string[] {
  return results.filter((result) => result.status === 'not-attempted' || (result.status === 'failed' && TOKEN_CODES.includes(result.code))).map((result) => result.sessionId);
}

/** The results as plain text, one line per session (the Copy button). */
export function grantResultsText(results: readonly BatchGrantResult[]): string {
  return results.map((result) => `${result.name} (${result.sessionId}): ${result.status}${result.text === '' ? '' : `. ${result.text}`}`).join('\n');
}

/** A bypass of one session in the revoke list. */
export interface GrantEntry {
  sessionId: string;
  name: string;
  grant: CliGrantDto;
}

export interface GrantGroup {
  category: string;
  entries: GrantEntry[];
}

/** The bypasses grouped by category: the most numerous category first, then by name. */
export function groupGrants(entries: readonly GrantEntry[]): GrantGroup[] {
  const groups = new Map<string, GrantEntry[]>();
  for (const entry of entries) {
    groups.set(entry.grant.category, [...(groups.get(entry.grant.category) ?? []), entry]);
  }
  return [...groups.entries()].map(([category, list]) => ({ category, entries: list })).sort((a, b) => b.entries.length - a.entries.length || a.category.localeCompare(b.category));
}

/** "Remove 3 bypasses (rm 2, git-push 1) from 3 sessions". */
export function revokeConfirmLine(ticked: readonly GrantEntry[]): string {
  const parts = groupGrants(ticked).map((group) => `${group.category} ${group.entries.length}`);
  return `Remove ${bypassesOf(ticked.length)} (${parts.join(', ')}) from ${sessionsOf(new Set(ticked.map((entry) => entry.sessionId)).size)}`;
}

/** "1 revoked, 1 failed". */
export function revokeSummaryText(results: readonly BatchRevokeResult[]): string {
  const order: BatchRevokeStatus[] = ['revoked', 'refused', 'failed'];
  return order
    .flatMap((status) => {
      const count = results.filter((result) => result.status === status).length;
      return count === 0 ? [] : [`${count} ${status}`];
    })
    .join(', ');
}

/** The results as plain text, one line per bypass (the Copy button). */
export function revokeResultsText(results: readonly BatchRevokeResult[]): string {
  return results.map((result) => `${result.name} (${result.sessionId}) ${result.grantId}: ${result.status}${result.text === '' ? '' : `. ${result.text}`}`).join('\n');
}

/** A read that failed: the sessions it concerns and the server's words. */
export interface ReadProblemLine {
  names: readonly string[];
  text: string;
}

export interface MergedReadProblems {
  /** One line per failed read: the sessions, then what is specific to them. */
  lines: { who: string; text: string }[];
  /** The closing sentences every failed read ends with (the same fix), said once. Empty with one problem or when they share none. */
  shared: string;
}

const sentencesOf = (text: string): string[] => text.split(/(?<=[.!?])\s+/).filter((sentence) => sentence !== '');

/** Several failed reads in one message: the words of each folder, and the fix they all share once (QA3 R16: the same fix was repeated in one banner per folder). */
export function mergeReadProblems(problems: readonly ReadProblemLine[]): MergedReadProblems {
  const split = problems.map((problem) => sentencesOf(problem.text));
  let common = 0;
  if (problems.length > 1) {
    const shortest = Math.min(...split.map((sentences) => sentences.length));
    // At least one sentence stays on each line: the shared tail is never the whole message.
    while (common < shortest - 1 && split.every((sentences) => sentences[sentences.length - 1 - common] === split[0]?.[(split[0]?.length ?? 0) - 1 - common])) {
      common += 1;
    }
  }
  const first = split[0] ?? [];
  return {
    lines: problems.map((problem, index) => ({ who: problem.names.join(', '), text: (split[index] ?? []).slice(0, (split[index]?.length ?? 0) - common).join(' ') })),
    shared: first.slice(first.length - common).join(' '),
  };
}
