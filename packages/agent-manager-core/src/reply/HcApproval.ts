import { createHash } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getErrorMessage } from '../errors.js';
import type { Session } from '../session.js';
import { auditDay } from './audit.js';
import { ReplyError } from './errors.js';
import { asRecord, createHcRunner, excerpt, failureOf } from './hcRunner.js';
import type { HcRunnerOptions } from './hcRunner.js';
import { DEFAULT_QUERY_TIMEOUT_MS, DEFAULT_SNAPSHOT_TTL_MS, createHcTerminals } from './hcTerminals.js';
import type { TerminalFacts } from './hcTerminals.js';

/*
 * Remote approval of a Claude Code permission dialog by typing the answer into its herdr-core terminal (`hc keys`, hc 0.1.21). Research:
 * research/permission-prompt-remote-answer.md (the mechanism) and research/hc-keys-approval.md (the keys, measured on a real dialog).
 *
 * What it does, in this order, for ONE decision:
 *   1. finds the terminal of the session (registry pid = foreground pid of the terminal, as the hc transport does; never a guess);
 *   2. reads the CURRENT state with `hc get` (must be blocked, kind permission) and the screen with `hc read`;
 *   3. recognises the dialog: a tool permission dialog ("Do you want to ...?", the cursor on "1. Yes", a last option "No"). Anything else (workspace
 *      trust dialog whose default is "No, exit", a question, a login) is refused: the keys mean something else there;
 *   4. computes the prompt id from what the user was shown (terminal, the moment hc says it became blocked, the dialog text) and refuses when it is not
 *      the id the user decided on (`prompt-changed`), or when this id was answered already (`already-answered`);
 *   5. writes the audit line (fail closed: no line, no keys);
 *   6. looks again AFTER the audit write (fresh hc get, hc read, hc get; the id is recomputed) and refuses `prompt-changed` unless it is the same id, then types with `hc keys` (argument array, no shell).
 *
 * Only allow ONCE and deny exist. "Yes, and always allow ..." (option 2) is NEVER offered nor typed: it writes a permanent permission rule into the
 * settings of the project from a remote click, which turns one approval into a standing one for any later command of that shape (T-08), and the web UI
 * shows only the command of this one call, not the rule that would be saved. THIS FILE NEVER PASSES --force (hc keys has no such flag; hc send has, and
 * it is the one that would answer a dialog by accident).
 *
 * Residual (cannot be removed from here): the window between the last `hc get` and the key press is a few tens of milliseconds, in which a person typing
 * in the same terminal could answer another dialog; hc keys itself waits "about 3 s of quiet" and does not check the status. The audit says what was typed.
 */

export const HC_APPROVAL_DECISIONS = ['allow', 'deny'] as const;
export type HcApprovalDecision = (typeof HC_APPROVAL_DECISIONS)[number];

/**
 * The key sequences. Measured on Claude Code 2.1.330 with hc 0.1.21 (research/hc-keys-approval.md): the dialog starts on "1. Yes", so `enter` is yes once;
 * `esc` is "Esc to cancel", the same as choosing "No". Frozen: a test fails when they change.
 */
export const ALLOW_KEYS: readonly string[] = Object.freeze(['enter']);
export const DENY_KEYS: readonly string[] = Object.freeze(['esc']);

export const DEFAULT_KEYS_TIMEOUT_MS = 15_000;
/** How long after the keys the terminal is watched for the dialog to go away. */
export const DEFAULT_SETTLE_MS = 4_000;
const SETTLE_POLL_MS = 400;
/** Characters of the command kept in the audit (the line is metadata, not the command). */
export const AUDIT_COMMAND_CHARS = 80;
/** A dialog body longer than this is not offered: the UI shows the WHOLE body (the hash covers it), never a cut one, so a longer one is answered in the terminal. */
export const MAX_BODY_CHARS = 20_000;
const MAX_ANSWERED = 500;

export interface HcPromptOption {
  number: number;
  label: string;
}

/** The permission dialog a terminal shows now, as the user must see it before deciding. */
export interface HcPrompt {
  /** Identifies this dialog (terminal, the moment it opened, its text): the decision must carry it. */
  promptId: string;
  terminal: string;
  /** `Bash` for `approve Bash: touch x` (hc status.msg); undefined when hc did not say. */
  tool: string | undefined;
  /** The first line of the dialog ("Bash command", "Edit file"). */
  header: string;
  /** The line under the header (the description Claude gave), '' when none. */
  description: string;
  /** The command or the change the dialog shows, as printed (several lines, whole: a body above MAX_BODY_CHARS is not offered). */
  body: string;
  /** Plain text the dialog shows between the closing rule of the command and the question (the reason of a hook "ask"), '' when none. Shown whole by the page. */
  notice: string;
  question: string;
  options: HcPromptOption[];
  /** What hc says (`approve Bash: touch am-allow.txt`). */
  statusMessage: string;
}

export type HcPromptState =
  /** A permission dialog is open and recognised: it can be answered. */
  | { kind: 'prompt'; prompt: HcPrompt }
  /** The terminal is not blocked (idle, working, done...): nothing to answer. */
  | { kind: 'none'; terminal: string; status: string }
  /** Blocked, but not on a dialog this module answers (a question, a login, the trust dialog, an unknown layout): answer it in the terminal. */
  | { kind: 'unsupported'; terminal: string; code: string; reason: string; fix: string };

export interface HcDecisionResult {
  decision: HcApprovalDecision;
  promptId: string;
  terminal: string;
  /** The keys typed. */
  keys: string[];
  tool: string | undefined;
  /**
   * What the terminal did after the keys: 'closed' (no longer the same dialog), 'unchanged' (still the same dialog after the wait: look at the terminal),
   * 'unknown' (the key was sent, or may have been, and the terminal could not be read afterwards: see `note`).
   */
  effect: 'closed' | 'unchanged' | 'unknown';
  /** '' unless `effect` is 'unknown': what happened and what to do. */
  note: string;
  /** The status of the terminal after the wait (`working`, `done`, ...). */
  statusAfter: string;
}

export interface HcApprovalAuditRecord {
  time: number;
  /** 'intent' is written before the keys (no line, no keys), 'result' after. */
  phase: 'intent' | 'result';
  sessionId: string;
  terminal: string;
  decision: HcApprovalDecision;
  keys: string[];
  promptId: string;
  /** sha256 (16 hex) of the dialog text. */
  textHash: string;
  tool: string | undefined;
  /** The first characters of the command, never the whole of it (it may hold a secret). */
  command: string;
  /** 'sending', 'sent: closed', 'sent: unchanged', 'failed: <reason>'. */
  outcome: string;
}

export interface HcApprovalOptions extends HcRunnerOptions {
  /** The config folder: the audit goes to `<configDir>/audit/hc-approval-<day>.ndjson`. Required unless `audit` is given. */
  configDir?: string;
  /** Test seam: replaces the audit file. */
  audit?: (record: HcApprovalAuditRecord) => Promise<void>;
  queryTimeoutMs?: number;
  keysTimeoutMs?: number;
  snapshotTtlMs?: number;
  settleMs?: number;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface HcApproval {
  /** The permission dialog of the session now. Throws a ReplyError when hc cannot be asked or the session has no herdr-core terminal. */
  read(session: Session): Promise<HcPromptState>;
  /** Answers the dialog the user saw (`promptId`). Throws a ReplyError (code says why, fix says what to do) when nothing was typed. */
  decide(session: Session, decision: HcApprovalDecision, promptId: string): Promise<HcDecisionResult>;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The dialog
// ---------------------------------------------------------------------------------------------------------------------------------------------------

// Box drawing characters built from code points (ASCII-only sources): 0x2500 solid rule, 0x254C dashed rule, 0x276F the cursor of the option list.
const OPTION_LINE = new RegExp(String.raw`^\s*(${String.fromCodePoint(0x276f)}\s*)?(\d{1,2})\.\s+(\S.*?)\s*$`);
const QUESTION_LINE = /^\s*(Do you want to .+\?)\s*$/;

function lastIndexWhere(lines: readonly string[], test: (line: string) => boolean): number {
  for (let index = lines.length - 1; index >= 0; index--) {
    if (test(lines[index]!)) {
      return index;
    }
  }
  return -1;
}

export type ParsedDialog =
  | { ok: true; header: string; description: string; body: string; notice: string; question: string; options: (HcPromptOption & { selected: boolean })[]; text: string }
  | { ok: false; code: string; reason: string };

/** A line made only of the rule character, at least 10 of them, with no leading blank. With `columns`, only a line exactly as wide as the terminal is a rule. */
function isRule(line: string, character: number, columns: number | undefined): boolean {
  const text = line.replace(/\s+$/, '');
  const mark = String.fromCodePoint(character);
  if (text.length < 10 || [...text].some((one) => one !== mark)) {
    return false;
  }
  return columns === undefined || text.length === columns;
}

export const MAX_NOTICE_LINES = 12;
export const MAX_NOTICE_CHARS = 2_000;
const BOX_CHARACTER = /[\u2500-\u257f]/;

/** Why a block of lines between the closing rule and the question is not accepted, undefined when it is plain text. */
function noticeFault(lines: readonly string[]): string | undefined {
  if (lines.length > MAX_NOTICE_LINES || lines.join('\n').length > MAX_NOTICE_CHARS) {
    return `more than ${MAX_NOTICE_LINES} lines or ${MAX_NOTICE_CHARS} characters`;
  }
  for (const line of lines) {
    if (BOX_CHARACTER.test(line)) {
      return 'a line has box-drawing characters';
    }
    if (OPTION_LINE.test(line) || QUESTION_LINE.test(line) || /^\s*Esc to cancel/.test(line)) {
      return 'a line looks like an option, the question or the footer';
    }
  }
  return undefined;
}

/**
 * Reads the permission dialog from the screen text of `hc read`. Pure. Recognises only the layout measured (a solid rule, the header, the description, the
 * body between two dashed rules, "Do you want to ...?", numbered options, "Esc to cancel"); anything else is `ok: false` with the reason.
 * `columns` (`cols` of `hc get`): the rules of the dialog are exactly that wide (measured: 200 of 200), so a line of the command that looks like a rule
 * (shorter, or indented) is body text and is shown whole. A rule-like line the parser cannot tell from the frame (a second top rule, a dashed rule that
 * makes the body ambiguous) is refused, never guessed: the body is everything between the first and the last dashed rule above the question.
 */
export function parsePermissionDialog(screen: string, columns?: number): ParsedDialog {
  const solid = (line: string): boolean => isRule(line, 0x2500, columns);
  const dashedRule = (line: string): boolean => isRule(line, 0x254c, columns);
  const lines = screen.replace(/\r/g, '').split('\n');
  const footer = lastIndexWhere(lines, (line) => /^\s*Esc to cancel/.test(line));
  if (footer === -1) {
    return { ok: false, code: 'dialog-not-recognized', reason: 'the screen has no "Esc to cancel" footer: no permission dialog is displayed' };
  }
  let last = footer - 1;
  while (last >= 0 && lines[last]!.trim() === '') {
    last--;
  }
  let first = last;
  while (first >= 0 && OPTION_LINE.test(lines[first]!)) {
    first--;
  }
  first++;
  if (first > last) {
    return { ok: false, code: 'dialog-not-recognized', reason: 'the dialog has no numbered options above its footer' };
  }
  const options = lines.slice(first, last + 1).map((line) => {
    const match = OPTION_LINE.exec(line)!;
    return { number: Number(match[2]), label: match[3]!, selected: match[1] !== undefined };
  });
  const questionMatch = first > 0 ? QUESTION_LINE.exec(lines[first - 1]!) : null;
  if (questionMatch === null) {
    return { ok: false, code: 'dialog-not-recognized', reason: `the line above the options is not a "Do you want to ...?" question (${excerpt(lines[first - 1] ?? '')})` };
  }
  const questionIndex = first - 1;
  const rule = lastIndexWhere(lines.slice(0, questionIndex), solid);
  if (rule === -1) {
    return { ok: false, code: 'dialog-not-recognized', reason: 'the dialog has no top rule: its first line cannot be told from the transcript above it' };
  }
  const inside = lines.slice(rule + 1, questionIndex);
  const dashed = inside.map((line, index) => (dashedRule(line) ? index : -1)).filter((index) => index !== -1);
  if (inside.some(solid) || dashed.length !== 2) {
    return { ok: false, code: 'dialog-not-recognized', reason: `the frame of the dialog is ambiguous (${dashed.length} dashed rules and ${inside.filter(solid).length} solid rule(s) between the top rule and the question, expected 2 and 0): a line of the command may imitate a rule` };
  }
  const [bodyStart, bodyEnd] = [dashed[0]!, dashed[1]!];
  // Text between the closing rule and the question (measured source: the reason of a hook "ask"). Accepted only as plain text that cannot imitate a part of the
  // dialog: no box character, no numbered option, no question, no footer, bounded. It is shown whole by the page and is part of the prompt id.
  const noticeLines = inside.slice(bodyEnd + 1).filter((line) => line.trim() !== '');
  const noticeProblem = noticeFault(noticeLines);
  if (noticeProblem !== undefined) {
    return { ok: false, code: 'dialog-not-recognized', reason: `there is text between the closing rule of the command and the question that is not plain text (${noticeProblem})` };
  }
  const noticeIndent = Math.min(...noticeLines.map((line) => /^ */.exec(line)![0].length));
  const notice = noticeLines.map((line) => line.slice(noticeIndent).replace(/\s+$/, '')).join('\n');
  const head = inside.slice(0, bodyStart);
  const headerIndex = head.findIndex((line) => line.trim() !== '');
  const header = headerIndex === -1 ? '' : head[headerIndex]!.trim();
  const description = head.slice(headerIndex + 1).map((line) => line.trim()).filter((line) => line !== '').join(' ');
  const bodyLines = inside.slice(bodyStart + 1, bodyEnd);
  const indent = Math.min(...bodyLines.filter((line) => line.trim() !== '').map((line) => /^ */.exec(line)![0].length));
  const body = bodyLines
    .map((line) => line.slice(Number.isFinite(indent) ? indent : 0).replace(/\s+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
  return { ok: true, header, description, body, notice, question: questionMatch[1]!, options, text: lines.slice(rule + 1, footer + 1).join('\n') };
}

/**
 * Checks that the dialog is the kind whose keys are known: the cursor is on option 1 which is a "Yes", the last option is "No". Returns the reason when not.
 * Option 1 is the one `enter` selects, and the last one is what `esc` stands for: with another layout the keys would mean something else.
 */
export function assertAnswerable(dialog: Extract<ParsedDialog, { ok: true }>): { code: string; reason: string } | undefined {
  const [firstOption] = dialog.options;
  const lastOption = dialog.options.at(-1);
  if (dialog.options.length < 2 || firstOption === undefined || lastOption === undefined) {
    return { code: 'dialog-not-recognized', reason: 'the dialog has fewer than two options' };
  }
  if (firstOption.number !== 1 || !/^Yes\b/.test(firstOption.label) || !firstOption.selected) {
    return { code: 'dialog-not-recognized', reason: `the cursor is not on a first option "1. Yes" (first option: ${firstOption.number}. ${excerpt(firstOption.label)}, cursor ${firstOption.selected ? 'on it' : 'elsewhere'}): enter would not mean "yes once"` };
  }
  if (!/^No\b/.test(lastOption.label)) {
    return { code: 'dialog-not-recognized', reason: `the last option is not "No" (${lastOption.number}. ${excerpt(lastOption.label)}): esc would not mean "no"` };
  }
  return undefined;
}

/** A one-line preview of at most `max` characters. */
function cut(text: string, max: number): string {
  const flat = text.replace(/s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

function toolOf(statusMessage: string | undefined): string | undefined {
  return /^approve\s+([^\s:]+)/.exec(statusMessage ?? '')?.[1];
}

function hashOf(parts: readonly string[], length: number): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, length);
}

function statusOf(terminal: TerminalFacts): string {
  return terminal.statusState ?? 'not reported';
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------
// The service
// ---------------------------------------------------------------------------------------------------------------------------------------------------

export function buildKeysArgs(address: string, keys: readonly string[]): string[] {
  const args = ['keys', '--json', '--', address, ...keys];
  if (args.some((arg) => arg.toLowerCase().includes('force'))) {
    throw new Error('hc approval must never pass --force');
  }
  return args;
}

export function createHcApproval(options: HcApprovalOptions = {}): HcApproval {
  const runner = createHcRunner({ ...(options.command === undefined ? {} : { command: options.command }), ...(options.commandArgs === undefined ? {} : { commandArgs: options.commandArgs }), ...(options.env === undefined ? {} : { env: options.env }) });
  const queryTimeoutMs = options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
  const keysTimeoutMs = options.keysTimeoutMs ?? DEFAULT_KEYS_TIMEOUT_MS;
  const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
  const clock = options.clock ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const terminals = createHcTerminals({ runner, queryTimeoutMs, snapshotTtlMs: options.snapshotTtlMs ?? DEFAULT_SNAPSHOT_TTL_MS, clock });
  const { configDir } = options;
  const audit =
    options.audit ??
    (async (record: HcApprovalAuditRecord): Promise<void> => {
      if (configDir === undefined) {
        throw new Error('no config folder was given to the hc approval');
      }
      await mkdir(join(configDir, 'audit'), { recursive: true });
      await appendFile(join(configDir, 'audit', `hc-approval-${auditDay(record.time)}.ndjson`), `${JSON.stringify(record)}\n`, 'utf8');
    });
  if (options.audit === undefined && configDir === undefined) {
    throw new Error('createHcApproval needs configDir (the audit folder) or an audit function: an approval without an audit line is refused by design');
  }

  // The prompts answered (or being answered): one decision per prompt. In memory: a restart forgets them, but the id holds the moment hc says the dialog opened.
  const answered = new Map<string, HcApprovalDecision>();

  function remember(promptId: string, decision: HcApprovalDecision): void {
    answered.set(promptId, decision);
    if (answered.size > MAX_ANSWERED) {
      const oldest = answered.keys().next().value;
      if (oldest !== undefined) {
        answered.delete(oldest);
      }
    }
  }

  async function screenOf(address: string): Promise<string> {
    const value = await terminals.query(['read', '--json', '--', address], `read ${address}`);
    const text = asRecord(value)?.['text'];
    if (typeof text !== 'string') {
      throw new ReplyError('hc-bad-answer', `hc read ${address} printed no "text" field`, 'report this: the hc output format changed (tested with hc 0.1.21)');
    }
    return text;
  }

  /** `hc get` of the terminal: the status, the moment it was set and the turn. */
  function statusSince(address: string): Promise<{ facts: TerminalFacts; sinceMs: number | undefined; turn: number | undefined }> {
    return terminals.getTerminal(address).then((facts) => ({ facts, sinceMs: facts.statusSinceMs, turn: facts.turn }));
  }

  function notBlocked(facts: TerminalFacts): ReplyError {
    return new ReplyError('not-blocked', `the terminal ${facts.address} is not blocked on a dialog any more (status ${statusOf(facts)})`, 'nothing to answer: the dialog was answered in the terminal, or the turn ended; refresh the session');
  }

  /** One consistent look at the terminal: hc get, hc read, then hc get again (the two gets must agree: the dialog did not change while the screen was read). */
  async function look(session: Session, polled: boolean): Promise<{ state: HcPromptState; id: string | undefined; dialog: Extract<ParsedDialog, { ok: true }> | undefined; facts: TerminalFacts }> {
    // A read (the poll of the card) may use a list of terminals up to 15 s old to find the terminal; a decision always lists them again.
    const known = await (polled ? terminals.polledTerminal(session) : terminals.freshTerminal(session));
    // `known` was read from hc just now (a terminal is never taken from the cache without being read again): it is the first of the two looks.
    const first = { facts: known, sinceMs: known.statusSinceMs, turn: known.turn };
    const { facts } = first;
    if (facts.foregroundPid !== session.pid) {
      throw new ReplyError('terminal-gone', `the terminal ${facts.address} no longer runs the session process (pid ${session.pid})`, 'the session ended or moved; refresh the session list');
    }
    if (facts.statusState !== 'blocked') {
      return { state: { kind: 'none', terminal: facts.address, status: statusOf(facts) }, id: undefined, dialog: undefined, facts };
    }
    if (facts.statusKind !== 'permission') {
      return {
        state: { kind: 'unsupported', terminal: facts.address, code: 'not-a-permission-dialog', reason: `the terminal ${facts.address} is blocked on ${facts.statusKind === undefined ? 'a dialog' : `a ${facts.statusKind} dialog`}${facts.statusMessage === undefined ? '' : ` (${excerpt(facts.statusMessage)})`}, not on a tool permission request`, fix: 'answer it in its terminal; agent-manager types only into tool permission dialogs' },
        id: undefined,
        dialog: undefined,
        facts,
      };
    }
    const screen = await screenOf(facts.address);
    const second = await statusSince(facts.address);
    if (second.facts.statusState !== 'blocked' || second.sinceMs !== first.sinceMs) {
      throw new ReplyError('prompt-changed', `the terminal ${facts.address} changed while its screen was read (status ${statusOf(second.facts)})`, 'read the dialog again before deciding');
    }
    const dialog = parsePermissionDialog(screen, facts.columns);
    const refusal = dialog.ok ? assertAnswerable(dialog) : { code: dialog.code, reason: dialog.reason };
    if (!dialog.ok || refusal !== undefined) {
      return {
        state: {
          kind: 'unsupported',
          terminal: facts.address,
          code: refusal?.code ?? 'dialog-not-recognized',
          reason: `the terminal ${facts.address} is blocked on a permission dialog this module cannot answer safely${facts.statusMessage === undefined ? '' : ` (${cut(facts.statusMessage, 80)})`}: ${refusal?.reason ?? 'unknown layout'}`,
          fix: 'answer it in its terminal (agent-manager only answers a tool dialog with the cursor on "1. Yes" and "No" last)',
        },
        id: undefined,
        dialog: undefined,
        facts,
      };
    }
    // The whole identity of the dialog: terminal, process, the moment hc says it opened, the turn, what hc says and the full dialog text.
    const id = hashOf([facts.address, String(facts.foregroundPid ?? ''), String(first.sinceMs ?? ''), String(first.turn ?? ''), facts.statusMessage ?? '', dialog.text], 16);
    if (dialog.body.length > MAX_BODY_CHARS) {
      return {
        state: { kind: 'unsupported', terminal: facts.address, code: 'dialog-too-long', reason: `the dialog of ${facts.address} shows ${dialog.body.length} characters, more than the ${MAX_BODY_CHARS} this page shows whole`, fix: 'read and answer it in its terminal: a part of it that you cannot see here could be what you approve' },
        id: undefined,
        dialog: undefined,
        facts,
      };
    }
    const prompt: HcPrompt = {
      promptId: id,
      terminal: facts.address,
      tool: toolOf(facts.statusMessage),
      header: dialog.header,
      description: dialog.description,
      body: dialog.body,
      notice: dialog.notice,
      question: dialog.question,
      options: dialog.options.map(({ number, label }) => ({ number, label })),
      statusMessage: facts.statusMessage ?? '',
    };
    return { state: { kind: 'prompt', prompt }, id, dialog, facts };
  }

  async function read(session: Session): Promise<HcPromptState> {
    return (await look(session, true)).state;
  }

  async function decide(session: Session, decision: HcApprovalDecision, promptId: string): Promise<HcDecisionResult> {
    if (!HC_APPROVAL_DECISIONS.includes(decision)) {
      throw new ReplyError('invalid-decision', `'${String(decision)}' is not a decision`, "send 'allow' (once) or 'deny'; 'always allow' is never offered remotely");
    }
    if (answered.has(promptId)) {
      throw new ReplyError('already-answered', `the prompt ${promptId} was already answered (${answered.get(promptId)})`, 'nothing was typed this time; look at the terminal, a new dialog gets a new id');
    }
    const seen = await look(session, false);
    if (seen.state.kind === 'none') {
      throw notBlocked(seen.facts);
    }
    if (seen.state.kind === 'unsupported') {
      throw new ReplyError(seen.state.code, seen.state.reason, seen.state.fix);
    }
    const { prompt } = seen.state;
    if (seen.id !== promptId || seen.dialog === undefined) {
      throw new ReplyError('prompt-changed', `the dialog of ${prompt.terminal} is not the one that was shown (it now asks: ${excerpt(prompt.statusMessage || prompt.header)})`, 'nothing was typed; read the dialog again and decide on what it shows now');
    }
    // Checked again after the look: another decision may have reserved the id while hc was answering.
    if (answered.has(promptId)) {
      throw new ReplyError('already-answered', `the prompt ${promptId} was already answered (${answered.get(promptId)})`, 'nothing was typed this time; look at the terminal');
    }
    // Reserved before anything is typed: a double click or a second page cannot type twice.
    remember(promptId, decision);
    const keys = [...(decision === 'allow' ? ALLOW_KEYS : DENY_KEYS)];
    const base = {
      sessionId: session.sessionId,
      terminal: prompt.terminal,
      decision,
      keys,
      promptId,
      textHash: hashOf([seen.dialog.text], 16),
      tool: prompt.tool,
      command: prompt.body.replace(/\s+/g, ' ').slice(0, AUDIT_COMMAND_CHARS),
    };
    try {
      await audit({ ...base, time: clock(), phase: 'intent', outcome: 'sending' });
    } catch (error) {
      answered.delete(promptId);
      throw new ReplyError('audit-unwritable', `the audit line cannot be written (${getErrorMessage(error)}), so nothing was typed`, 'fix the config folder (permissions, disk space), or answer the dialog in its terminal');
    }
    const result = async (outcome: string): Promise<void> => {
      try {
        await audit({ ...base, time: clock(), phase: 'result', outcome });
      } catch {
        // The intent line exists; a missing result line is visible in the audit as an intent without result.
      }
    };
    // The last look, AFTER the audit write (which takes time): the full identity of the dialog is recomputed from a fresh hc get + hc read + hc get and must
    // be the id the user decided on (terminal, process, the moment hc says it opened, turn, status message, dialog text). Else nothing is typed.
    const refuse = async (error: ReplyError): Promise<never> => {
      answered.delete(promptId);
      await result(`failed: ${error.code}: ${error.reason}`);
      throw error;
    };
    let last: Awaited<ReturnType<typeof look>>;
    try {
      last = await look(session, false);
    } catch (error) {
      answered.delete(promptId);
      await result(`failed: ${getErrorMessage(error)}`);
      throw error;
    }
    if (last.state.kind === 'none') {
      return refuse(notBlocked(last.facts));
    }
    if (last.state.kind === 'unsupported') {
      return refuse(new ReplyError(last.state.code, last.state.reason, last.state.fix));
    }
    if (last.id !== promptId) {
      return refuse(new ReplyError('prompt-changed', `the dialog of ${prompt.terminal} changed while the answer was being prepared (it now asks: ${excerpt(last.state.prompt.statusMessage || last.state.prompt.header)})`, 'nothing was typed; read the dialog again and decide on what it shows now'));
    }
    const sinceMs = last.facts.statusSinceMs;
    let run: Awaited<ReturnType<typeof runner.run>>;
    try {
      run = await runner.run(buildKeysArgs(prompt.terminal, keys), keysTimeoutMs, 'keys', 'the keys may or may not have been typed: look at the terminal before answering again');
    } catch (error) {
      // A timeout (or an output flood) happens AFTER hc was started: the key may have been typed. hc missing or not startable: it was not.
      if (error instanceof ReplyError && (error.code === 'hc-timeout' || error.code === 'hc-output-too-large')) {
        const note = `${error.reason}: the key may or may not have been typed, check the terminal ${prompt.terminal} before answering again`;
        await result(`unknown: ${error.code}`);
        return { decision, promptId, terminal: prompt.terminal, keys, tool: prompt.tool, effect: 'unknown', note, statusAfter: 'unknown' };
      }
      answered.delete(promptId);
      await result(`failed: ${getErrorMessage(error)}`);
      throw error;
    }
    const failure = failureOf(run);
    if (run.code !== 0 || failure !== undefined) {
      answered.delete(promptId);
      // An hc that printed its JSON error refused before typing; an exit code alone does not say whether anything was typed.
      const reason = failure === undefined ? `hc keys failed (exit ${String(run.code)}): ${excerpt(run.stderr || run.stdout) || 'no output'}; it is not known whether the key was typed` : `hc keys refused (${failure.kind}): ${failure.message}; the key was not typed`;
      await result(`failed: ${reason}`);
      throw new ReplyError(failure?.kind === 'not_found' ? 'terminal-gone' : 'hc-keys-failed', reason, failure?.hint !== undefined && failure.hint !== '' ? failure.hint : 'look at the terminal (hc read), answer it there if needed');
    }
    // From here the key WAS sent: no error may say otherwise. Did the dialog go away? Watched for a few seconds; the answer says what was seen, never assumes.
    let effect: HcDecisionResult['effect'] = 'unchanged';
    let note = '';
    let statusAfter = 'blocked';
    const deadline = clock() + settleMs;
    try {
      for (;;) {
        await sleep(SETTLE_POLL_MS);
        try {
          const now = await statusSince(prompt.terminal);
          statusAfter = statusOf(now.facts);
          if (now.facts.statusState !== 'blocked' || now.sinceMs !== sinceMs) {
            effect = 'closed';
            break;
          }
        } catch (error) {
          if (error instanceof ReplyError && error.code === 'terminal-gone') {
            effect = 'closed';
            statusAfter = 'terminal ended';
            break;
          }
          throw error;
        }
        if (clock() >= deadline) {
          break;
        }
      }
    } catch (error) {
      effect = 'unknown';
      statusAfter = 'unknown';
      note = `the key was sent, check the terminal ${prompt.terminal} (it could not be read afterwards: ${getErrorMessage(error)})`;
    }
    await result(effect === 'unknown' ? 'sent: unknown (terminal not readable afterwards)' : `sent: ${effect}`);
    return { decision, promptId, terminal: prompt.terminal, keys, tool: prompt.tool, effect, note, statusAfter };
  }

  return { read, decide };
}
