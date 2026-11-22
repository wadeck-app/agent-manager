import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { parseSession } from '../parseSession.js';
import type { Session } from '../session.js';
import { registryEntry } from '../testFixtures.js';
import { ReplyError } from './errors.js';
import { ALLOW_KEYS, DENY_KEYS, assertAnswerable, buildKeysArgs, createHcApproval, parsePermissionDialog } from './HcApproval.js';
import type { HcApprovalAuditRecord, HcApprovalOptions } from './HcApproval.js';

/*
 * Fakes only: the approval runs `node fakeHcKeys.mjs`, never the real hc, so nothing here can type into a real terminal. The screens are the ones measured
 * on a real dialog (research/hc-keys-approval.md), with the box characters built from code points (ASCII-only sources).
 */

const FAKE_HC = fileURLToPath(new URL('./fakeHcKeys.mjs', import.meta.url));
const SESSION_PID = 4242;
const RULE = String.fromCodePoint(0x2500).repeat(40);
const DASHES = String.fromCodePoint(0x254c).repeat(40);
const CURSOR = String.fromCodePoint(0x276f);
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
});

function dialogScreen(options: { command?: string; description?: string; question?: string; cursorOn?: number; labels?: string[]; header?: string; between?: string[] } = {}): string {
  const labels = options.labels ?? ['Yes', 'Yes, and always allow access to C:\\proj from this project', 'No'];
  const cursorOn = options.cursorOn ?? 1;
  return [
    '* Bash(touch am-allow.txt)',
    '  L Waiting...',
    '',
    RULE,
    ` ${options.header ?? 'Bash command'}`,
    ` ${options.description ?? 'Create am-allow.txt file'}`,
    DASHES,
    ` ${options.command ?? 'touch am-allow.txt'}`,
    DASHES,
    ...(options.between ?? []),
    ` ${options.question ?? 'Do you want to proceed?'}`,
    ...labels.map((label, index) => `${index + 1 === cursorOn ? ` ${CURSOR} ` : '   '}${index + 1}. ${label}`),
    '',
    ' Esc to cancel . Tab to amend',
  ].join('\n');
}

const TRUST_SCREEN = [
  RULE,
  ' Accessing workspace:',
  '',
  ' C:\\proj',
  '',
  ' Quick safety check: Is this a project you created or one you trust?',
  '',
  ` ${CURSOR} 1. No, exit`,
  '   2. Yes, I trust this folder',
  '',
  ' Enter to confirm . Esc to cancel',
].join('\n');

const claude = (address: string) => ({ address, agent: 'claude-code', state: 'live', status: 'blocked', turn: 3 });
const blocked = (sinceMs = 1000, msg = 'approve Bash: touch am-allow.txt', kind = 'permission') => ({ foreground: { pid: SESSION_PID, name: 'claude.exe' }, status: { app: 'claude-code', state: 'blocked', kind, msg }, status_ms: sinceMs, turn: 1 });
const idle = (sinceMs = 2000) => ({ foreground: { pid: SESSION_PID, name: 'claude.exe' }, status: { app: 'claude-code', state: 'working' }, status_ms: sinceMs, turn: 1 });

interface Scenario {
  ls?: unknown;
  get?: Record<string, unknown>;
  afterKeys?: Record<string, unknown>;
  read?: Record<string, string>;
  keys?: { exit?: number; stdout: unknown };
}

const BASE: Scenario = { ls: { terminals: [claude('t2')] }, get: { t2: blocked() }, afterKeys: { t2: idle() }, read: { t2: dialogScreen() } };

interface Call {
  argv: string[];
}

function setup(scenario: Scenario = BASE, options: Partial<HcApprovalOptions> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-manager-fakehckeys-'));
  dirs.push(dir);
  const stateDir = join(dir, 'state');
  mkdirSync(stateDir);
  const scenarioFile = join(dir, 'scenario.json');
  const logFile = join(dir, 'calls.ndjson');
  writeFileSync(scenarioFile, JSON.stringify(scenario));
  writeFileSync(logFile, '');
  const audits: HcApprovalAuditRecord[] = [];
  const approval = createHcApproval({
    command: process.execPath,
    commandArgs: [FAKE_HC],
    env: () => ({ ...process.env, FAKE_HC_SCENARIO: scenarioFile, FAKE_HC_LOG: logFile, FAKE_HC_STATE: stateDir }),
    queryTimeoutMs: 20_000,
    keysTimeoutMs: 20_000,
    settleMs: 50,
    sleep: () => Promise.resolve(),
    audit: (record) => {
      audits.push(record);
      return Promise.resolve();
    },
    ...options,
  });
  const calls = (): Call[] =>
    readFileSync(logFile, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Call);
  const keyCalls = (): Call[] => calls().filter((call) => call.argv[0] === 'keys');
  const rewrite = (next: Scenario): void => writeFileSync(scenarioFile, JSON.stringify(next));
  return { approval, calls, keyCalls, audits, rewrite };
}

function session(): Session {
  return parseSession(`${SESSION_PID}.json`, registryEntry(SESSION_PID, { sessionId: 'sess-1' }), { now: 2_000_000, isAlive: () => true });
}

async function failureOf(promise: Promise<unknown>): Promise<ReplyError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ReplyError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a ReplyError, the call succeeded');
}

async function currentPromptId(approval: ReturnType<typeof setup>['approval']): Promise<string> {
  const state = await approval.read(session());
  if (state.kind !== 'prompt') {
    throw new Error(`expected a prompt, got ${state.kind}`);
  }
  return state.prompt.promptId;
}

describe('the keys', () => {
  it('are enter for allow once and esc for deny, frozen, and never option 2, shift+tab or a force flag', () => {
    expect(ALLOW_KEYS).toEqual(['enter']);
    expect(DENY_KEYS).toEqual(['esc']);
    expect(Object.isFrozen(ALLOW_KEYS)).toBe(true);
    expect(Object.isFrozen(DENY_KEYS)).toBe(true);
    expect(buildKeysArgs('t2', ALLOW_KEYS)).toEqual(['keys', '--json', '--', 't2', 'enter']);
    expect(() => buildKeysArgs('t2', ['--force'])).toThrow(/never pass --force/);
  });
});

describe('parsePermissionDialog (the layout measured on Claude Code 2.1.330)', () => {
  it('reads header, description, body, question and options', () => {
    const dialog = parsePermissionDialog(dialogScreen());
    expect(dialog).toMatchObject({ ok: true, header: 'Bash command', description: 'Create am-allow.txt file', body: 'touch am-allow.txt', question: 'Do you want to proceed?' });
    if (dialog.ok) {
      expect(dialog.options.map((option) => [option.number, option.label, option.selected])).toEqual([
        [1, 'Yes', true],
        [2, 'Yes, and always allow access to C:\\proj from this project', false],
        [3, 'No', false],
      ]);
      expect(assertAnswerable(dialog)).toBeUndefined();
    }
  });

  it('keeps a multi-line command with its relative indentation', () => {
    const screen = dialogScreen({ command: 'echo a\n   indented\n echo b' });
    const dialog = parsePermissionDialog(screen);
    expect(dialog).toMatchObject({ ok: true, body: 'echo a\n  indented\necho b' });
  });

  it('refuses the workspace trust dialog (its first option is "No, exit": enter would exit)', () => {
    const dialog = parsePermissionDialog(TRUST_SCREEN);
    expect(dialog).toMatchObject({ ok: false, code: 'dialog-not-recognized' });
  });

  it('refuses a dialog whose cursor is not on option 1, whose first option is not Yes, or whose last option is not No', () => {
    const moved = parsePermissionDialog(dialogScreen({ cursorOn: 2 }));
    expect(moved.ok && assertAnswerable(moved)?.reason).toMatch(/cursor is not on a first option/);
    const other = parsePermissionDialog(dialogScreen({ labels: ['Run it', 'No'] }));
    expect(other.ok && assertAnswerable(other)?.reason).toMatch(/cursor is not on a first option/);
    const lastNotNo = parsePermissionDialog(dialogScreen({ labels: ['Yes', 'Yes, always', 'Maybe'] }));
    expect(lastNotNo.ok && assertAnswerable(lastNotNo)?.reason).toMatch(/last option is not "No"/);
  });

  it('a command with rule-like lines is shown WHOLE: shorter or indented rule lines are body text, not frame', () => {
    const short = String.fromCodePoint(0x254c).repeat(20);
    const command = `echo safe\n${short}\n  ${RULE}\necho hidden-part`;
    const dialog = parsePermissionDialog(dialogScreen({ command }), 40);
    expect(dialog).toMatchObject({ ok: true, header: 'Bash command', description: 'Create am-allow.txt file' });
    if (dialog.ok) {
      // Everything the agent will run is in the body, including the part after the imitated rule.
      expect(dialog.body).toContain('echo safe');
      expect(dialog.body).toContain('echo hidden-part');
      expect(dialog.body.split('\n')).toHaveLength(4);
      expect(dialog.text).toContain('echo hidden-part');
    }
  });

  it('refuses, as ambiguous, a rule-like line as wide as the terminal inside the command (dashed or solid)', () => {
    for (const mark of [0x254c, 0x2500]) {
      const spoof = String.fromCodePoint(mark).repeat(40);
      const dialog = parsePermissionDialog(dialogScreen({ command: `echo shown\n${spoof}\n${spoof}\necho hidden` }), 40);
      expect(dialog, String(mark)).toMatchObject({ ok: false, code: 'dialog-not-recognized', reason: expect.stringMatching(/ambiguous/) });
    }
  });

  it('without the terminal width, any unindented rule line of 10 or more is treated as frame (so the spoof is refused too)', () => {
    const spoof = String.fromCodePoint(0x254c).repeat(12);
    expect(parsePermissionDialog(dialogScreen({ command: `echo shown\n${spoof}\necho hidden` }))).toMatchObject({ ok: false, reason: expect.stringMatching(/ambiguous/) });
  });

  describe('text between the closing rule of the command and the question (the reason of a hook "ask")', () => {
    const CONTINUED = 'node "${USERPROFILE:-$HOME}/scripts/grant.js" \\\n  --category git-commit-push \\\n  --mode 30m \\\n  --session f30960b8-0000-0000-0000-000000000000 \\\n  --token 0123456789abcdef';
    const NOTICE = [' HOOK REQUEST for THIS agent - session f30960b8', '   Category  git-commit-push', '   Duration  30m, starts now', '   Reason    commit and push the work', ''];

    it('reads a multi-line command with backslash continuations and keeps the extra text apart as the notice, never in the body', () => {
      const dialog = parsePermissionDialog(dialogScreen({ command: CONTINUED, between: NOTICE }), 40);
      expect(dialog).toMatchObject({ ok: true, question: 'Do you want to proceed?' });
      if (dialog.ok) {
        expect(dialog.body.split('\n')).toHaveLength(5);
        expect(dialog.body).toContain('--token 0123456789abcdef');
        expect(dialog.body).not.toContain('HOOK REQUEST');
        expect(dialog.notice).toBe('HOOK REQUEST for THIS agent - session f30960b8\n  Category  git-commit-push\n  Duration  30m, starts now\n  Reason    commit and push the work');
        expect(dialog.text).toContain('Reason    commit and push the work');
        expect(assertAnswerable(dialog)).toBeUndefined();
      }
    });

    it('has an empty notice when there is none', () => {
      expect(parsePermissionDialog(dialogScreen())).toMatchObject({ ok: true, notice: '' });
    });

    it('refuses extra text that holds a rule-like line, a numbered option, a question or the footer (it could hide or imitate part of the dialog)', () => {
      const bad: Record<string, string> = {
        'dashed rule': String.fromCodePoint(0x254c).repeat(12),
        'solid rule': String.fromCodePoint(0x2500).repeat(12),
        option: '  2. Yes, and always allow',
        cursor: ` ${CURSOR} 1. Yes`,
        question: ' Do you want to run this?',
        footer: ' Esc to cancel',
      };
      for (const [name, line] of Object.entries(bad)) {
        const dialog = parsePermissionDialog(dialogScreen({ between: [' some text', line] }));
        expect(dialog, name).toMatchObject({ ok: false, code: 'dialog-not-recognized', reason: expect.stringMatching(/ambiguous|between the closing rule/) });
      }
    });

    it('refuses an extra text longer than 12 lines or 2000 characters', () => {
      const many = Array.from({ length: 13 }, (_, index) => ` line ${index}`);
      expect(parsePermissionDialog(dialogScreen({ between: many }))).toMatchObject({ ok: false, reason: expect.stringMatching(/ambiguous|between the closing rule/) });
      expect(parsePermissionDialog(dialogScreen({ between: [` ${'x'.repeat(2100)}`] }))).toMatchObject({ ok: false, reason: expect.stringMatching(/ambiguous|between the closing rule/) });
    });
  });

  it('refuses a screen with no dialog, a dialog with no question or with a question that is not "Do you want to"', () => {
    expect(parsePermissionDialog('just a prompt\n> ')).toMatchObject({ ok: false });
    expect(parsePermissionDialog(dialogScreen({ question: 'Select a model?' }))).toMatchObject({ ok: false, reason: expect.stringMatching(/not a "Do you want to/) });
  });

  it('accepts a dialog with two options only (no "always allow" line)', () => {
    const dialog = parsePermissionDialog(dialogScreen({ labels: ['Yes', 'No'], question: 'Do you want to make this edit to a.txt?' }));
    expect(dialog.ok && assertAnswerable(dialog)).toBeFalsy();
    expect(dialog.ok).toBe(true);
  });
});

describe('read', () => {
  it('returns the prompt: tool, command, options and a stable id; reads hc get twice around hc read', async () => {
    const { approval, calls } = setup();
    const state = await approval.read(session());
    expect(state).toMatchObject({ kind: 'prompt', prompt: { terminal: 't2', tool: 'Bash', header: 'Bash command', description: 'Create am-allow.txt file', body: 'touch am-allow.txt', statusMessage: 'approve Bash: touch am-allow.txt' } });
    expect(await currentPromptId(approval)).toBe(state.kind === 'prompt' ? state.prompt.promptId : '');
    const firstRound = calls().slice(0, 4).map((call) => call.argv[0]);
    expect(firstRound).toEqual(['ls', 'get', 'get', 'read']);
  });

  it('gives a new dialog with the same text a new id (hc says the status changed)', async () => {
    const { approval } = setup({ ...BASE, get: { t2: blocked(1000) } });
    const second = setup({ ...BASE, get: { t2: blocked(5000) } });
    expect(await currentPromptId(approval)).not.toBe(await currentPromptId(second.approval));
  });

  it('says nothing to answer for a terminal that is not blocked', async () => {
    const { approval, keyCalls } = setup({ ...BASE, get: { t2: idle() } });
    expect(await approval.read(session())).toEqual({ kind: 'none', terminal: 't2', status: 'working' });
    expect(keyCalls()).toEqual([]);
  });

  it('says unsupported for a blocked terminal that is not a permission dialog (question, auth)', async () => {
    const { approval } = setup({ ...BASE, get: { t2: blocked(1000, 'Not logged in', 'auth') } });
    expect(await approval.read(session())).toMatchObject({ kind: 'unsupported', code: 'not-a-permission-dialog', reason: expect.stringMatching(/blocked on a auth dialog/) });
  });

  it('says unsupported, with the fix, for the workspace trust dialog (kind permission, default "No, exit")', async () => {
    const { approval } = setup({ ...BASE, get: { t2: blocked(1000, 'trust this folder') }, read: { t2: TRUST_SCREEN } });
    expect(await approval.read(session())).toMatchObject({ kind: 'unsupported', code: 'dialog-not-recognized', fix: expect.stringMatching(/answer it in its terminal/) });
  });

  it('offers the dialog of a hook ask (multi-line command, extra text above the question) with the notice, and types enter for allow', async () => {
    const screen = dialogScreen({ command: 'node grant.js \\\n  --category git-commit-push \\\n  --mode 30m', between: [' HOOK REQUEST for THIS agent', '   Category  git-commit-push', ''] });
    const { approval, keyCalls } = setup({ ...BASE, read: { t2: screen } });
    const state = await approval.read(session());
    expect(state).toMatchObject({ kind: 'prompt', prompt: { notice: 'HOOK REQUEST for THIS agent\n  Category  git-commit-push' } });
    expect(state.kind === 'prompt' && state.prompt.body.split('\n')).toHaveLength(3);
    const result = await approval.decide(session(), 'allow', await currentPromptId(approval));
    expect(result.keys).toEqual(['enter']);
    expect(keyCalls()).toHaveLength(1);
  });

  it('the notice is part of the prompt id: another notice, another id', async () => {
    const one = setup({ ...BASE, read: { t2: dialogScreen({ between: [' reason A'] }) } });
    const two = setup({ ...BASE, read: { t2: dialogScreen({ between: [' reason B'] }) } });
    expect(await currentPromptId(one.approval)).not.toBe(await currentPromptId(two.approval));
  });

  it('refuses with a short message: the status message cut to 80 characters, what to do', async () => {
    const msg = `approve Bash: ${'x'.repeat(300)}`;
    const { approval } = setup({ ...BASE, get: { t2: blocked(1000, msg) }, read: { t2: dialogScreen({ between: [' ok', String.fromCodePoint(0x254c).repeat(12)] }) } });
    const state = await approval.read(session());
    expect(state.kind).toBe('unsupported');
    if (state.kind === 'unsupported') {
      expect(state.reason).not.toContain('x'.repeat(81));
      expect(state.reason.length).toBeLessThan(400);
      expect(state.fix).toMatch(/answer it in its terminal/);
    }
  });

  it('throws no-terminal with the "started in a herdr-core terminal" explanation when no terminal runs the session', async () => {
    const { approval } = setup({ ...BASE, get: { t2: { ...blocked(), foreground: { pid: 1, name: 'claude.exe' } } } });
    const error = await failureOf(approval.read(session()));
    expect(error.code).toBe('no-terminal');
    expect(error.reason).toMatch(/not started in a herdr-core terminal/);
  });

  it('a poll of a session with no herdr-core terminal lists the terminals once per snapshot, not once per poll', async () => {
    const { approval, calls } = setup({ ...BASE, get: { t2: { ...blocked(), foreground: { pid: 1, name: 'claude.exe' } } } });
    for (let index = 0; index < 3; index++) {
      expect((await failureOf(approval.read(session()))).code).toBe('no-terminal');
    }
    expect(calls().filter((call) => call.argv[0] === 'ls')).toHaveLength(1);
  });

  describe('the polls of a session without a matching terminal', () => {
    const away = { ...BASE, get: { t2: { ...blocked(), foreground: { pid: 1, name: 'claude.exe' } } } };
    const lists = (calls: () => { argv: string[] }[]): number => calls().filter((call) => call.argv[0] === 'ls').length;

    it('a session that was never in hc costs one scan per TTL, not one per poll', async () => {
      let now = 1_000_000;
      const { approval, calls } = setup(away, { clock: () => now });
      for (let index = 0; index < 5; index++) {
        expect((await failureOf(approval.read(session()))).code).toBe('no-terminal');
      }
      expect(lists(calls)).toBe(1);
      const gets = calls().filter((call) => call.argv[0] === 'get').length;
      now += 16_000;
      await failureOf(approval.read(session()));
      expect(lists(calls)).toBe(2);
      expect(calls().filter((call) => call.argv[0] === 'get').length).toBe(gets * 2);
    });

    it('a remembered terminal that is gone costs one full listing, then nothing until the TTL', async () => {
      let now = 1_000_000;
      const { approval, calls, rewrite } = setup(BASE, { clock: () => now });
      expect((await approval.read(session())).kind).toBe('prompt');
      expect(lists(calls)).toBe(1);
      rewrite(away);
      for (let index = 0; index < 5; index++) {
        expect((await failureOf(approval.read(session()))).code).toBe('no-terminal');
      }
      // The first list of the match, plus ONE forced list when the remembered terminal was found gone; the four polls after that asked nothing.
      expect(lists(calls)).toBe(2);
      const before = calls().length;
      await failureOf(approval.read(session()));
      expect(calls().length).toBe(before);
    });

    it('the terminal that reappears is found after the TTL', async () => {
      let now = 1_000_000;
      const { approval, rewrite } = setup(away, { clock: () => now });
      await failureOf(approval.read(session()));
      rewrite(BASE);
      await failureOf(approval.read(session()));
      now += 16_000;
      expect((await approval.read(session())).kind).toBe('prompt');
    });

    it('a user action (a decision) looks again at once, without waiting for the TTL', async () => {
      const now = 1_000_000;
      const { approval, rewrite, keyCalls } = setup(away, { clock: () => now });
      await failureOf(approval.read(session()));
      rewrite(BASE);
      // The poll still says no-terminal (cached); the decision found the terminal (it fails on the unknown prompt id, not on the terminal).
      expect((await failureOf(approval.read(session()))).code).toBe('no-terminal');
      expect((await failureOf(approval.decide(session(), 'allow', 'deadbeefdeadbeef'))).code).toBe('prompt-changed');
      expect(keyCalls()).toEqual([]);
    });
  });

  it('throws hc-missing when hc cannot be started', async () => {
    const { approval } = setup(BASE, { command: 'hc-does-not-exist-am', commandArgs: [] });
    expect((await failureOf(approval.read(session()))).code).toBe('hc-missing');
  });

  it('refuses a screen read while the status changes (prompt-changed)', async () => {
    // The first read lists the terminals (one get) then reads get, read, get: the second get differs from the first.
    const { approval, keyCalls } = setup({ ...BASE, get: { t2: [blocked(1000), blocked(1000), blocked(9000)] } });
    expect((await failureOf(approval.read(session()))).code).toBe('prompt-changed');
    expect(keyCalls()).toEqual([]);
  });
});

describe('decide', () => {
  it('allow: types enter once, audits intent before and result after, and sees the dialog close', async () => {
    const { approval, keyCalls, audits, calls } = setup();
    const id = await currentPromptId(approval);
    const result = await approval.decide(session(), 'allow', id);
    expect(result).toMatchObject({ decision: 'allow', promptId: id, terminal: 't2', keys: ['enter'], tool: 'Bash', effect: 'closed', statusAfter: 'working' });
    expect(keyCalls().map((call) => call.argv)).toEqual([['keys', '--json', '--', 't2', 'enter']]);
    expect(audits.map((record) => [record.phase, record.outcome])).toEqual([
      ['intent', 'sending'],
      ['result', 'sent: closed'],
    ]);
    expect(audits[0]).toMatchObject({ sessionId: 'sess-1', terminal: 't2', decision: 'allow', keys: ['enter'], tool: 'Bash', command: 'touch am-allow.txt', promptId: id });
    expect(audits[0]?.textHash).toMatch(/^[0-9a-f]{16}$/);
    // The keys come after a complete second look (get, read, get) that follows the audit write: the last read is the one right before them.
    const names = calls().map((call) => call.argv[0]);
    expect(names.slice(names.lastIndexOf('read'), names.indexOf('keys') + 1)).toEqual(['read', 'get', 'keys']);
    expect(JSON.stringify(calls())).not.toMatch(/force/);
  });

  it('deny: types esc once', async () => {
    const { approval, keyCalls } = setup();
    const result = await approval.decide(session(), 'deny', await currentPromptId(approval));
    expect(result).toMatchObject({ decision: 'deny', keys: ['esc'] });
    expect(keyCalls().map((call) => call.argv)).toEqual([['keys', '--json', '--', 't2', 'esc']]);
  });

  it('refuses with prompt-changed, typing nothing, when the dialog is not the one the user saw', async () => {
    const { approval, keyCalls, audits } = setup();
    const error = await failureOf(approval.decide(session(), 'allow', 'deadbeefdeadbeef'));
    expect(error.code).toBe('prompt-changed');
    expect(error.fix).toMatch(/nothing was typed/);
    expect(keyCalls()).toEqual([]);
    expect(audits).toEqual([]);
  });

  it('refuses when the same command is asked again as a new dialog (new moment, same text: the old id is stale)', async () => {
    const first = setup({ ...BASE, get: { t2: blocked(1000) } });
    const oldId = await currentPromptId(first.approval);
    const again = setup({ ...BASE, get: { t2: blocked(7000) } });
    expect((await failureOf(again.approval.decide(session(), 'allow', oldId))).code).toBe('prompt-changed');
    expect(again.keyCalls()).toEqual([]);
  });

  it('answers once per prompt: the second decision (allow or deny) is already-answered and types nothing', async () => {
    const { approval, keyCalls } = setup({ ...BASE, afterKeys: { t2: blocked() } });
    const id = await currentPromptId(approval);
    const first = await approval.decide(session(), 'allow', id);
    expect(first.effect).toBe('unchanged');
    expect((await failureOf(approval.decide(session(), 'allow', id))).code).toBe('already-answered');
    expect((await failureOf(approval.decide(session(), 'deny', id))).code).toBe('already-answered');
    expect(keyCalls()).toHaveLength(1);
  });

  it('two concurrent decisions on one prompt type once', async () => {
    const { approval, keyCalls } = setup();
    const id = await currentPromptId(approval);
    const outcomes = await Promise.allSettled([approval.decide(session(), 'allow', id), approval.decide(session(), 'deny', id)]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(keyCalls()).toHaveLength(1);
  });

  it('refuses a terminal that is no longer blocked (not-blocked), typing nothing', async () => {
    const { approval, keyCalls } = setup({ ...BASE, get: { t2: [blocked(), blocked(), blocked(), idle()] } });
    const id = await currentPromptId(approval);
    // The look of decide: get, get, read, get are all fine ... then the last get before the keys says working.
    const second = await failureOf(approval.decide(session(), 'allow', id));
    expect(['not-blocked', 'prompt-changed']).toContain(second.code);
    expect(keyCalls()).toEqual([]);
  });

  it('refuses a dialog that became unsupported, typing nothing', async () => {
    const { approval, keyCalls } = setup({ ...BASE, read: { t2: TRUST_SCREEN } });
    const error = await failureOf(approval.decide(session(), 'allow', 'whatever'));
    expect(error.code).toBe('dialog-not-recognized');
    expect(keyCalls()).toEqual([]);
  });

  it('is fail closed: no audit line, no keys', async () => {
    const { approval, keyCalls } = setup(BASE, {
      audit: () => Promise.reject(new Error('disk full')),
    });
    const id = await currentPromptId(approval);
    const error = await failureOf(approval.decide(session(), 'allow', id));
    expect(error.code).toBe('audit-unwritable');
    expect(error.reason).toMatch(/disk full.*nothing was typed/);
    expect(keyCalls()).toEqual([]);
  });

  it('reports a failing hc keys with its reason, frees the prompt for a retry and audits the failure', async () => {
    const { approval, audits } = setup({ ...BASE, keys: { exit: 1, stdout: { error: { kind: 'invalid', message: 'bad key', hint: 'see hc keys --help' } } } });
    const id = await currentPromptId(approval);
    const error = await failureOf(approval.decide(session(), 'allow', id));
    expect(error).toMatchObject({ code: 'hc-keys-failed', fix: 'see hc keys --help' });
    expect(error.reason).toMatch(/hc keys refused \(invalid\): bad key/);
    expect(audits.at(-1)?.outcome).toMatch(/^failed: hc keys refused/);
    // Retry is allowed (the keys did not go): it fails again the same way, not with already-answered.
    expect((await failureOf(approval.decide(session(), 'allow', id))).code).toBe('hc-keys-failed');
  });

  it('rejects a decision other than allow or deny (no always-allow)', async () => {
    const { approval, keyCalls } = setup();
    const error = await failureOf(approval.decide(session(), 'always' as never, 'x'));
    expect(error.code).toBe('invalid-decision');
    expect(keyCalls()).toEqual([]);
  });

  it('re-checks the whole identity AFTER the audit write: a dialog that changed in between gets nothing typed, and the failure is audited', async () => {
    // Gets: read (snapshot, fresh, second) = 0-2, decide's first look = 3-4, the look after the audit = 5-6: from the 6th on, hc says a new dialog opened.
    const { approval, keyCalls, audits } = setup({ ...BASE, get: { t2: [blocked(1000), blocked(1000), blocked(1000), blocked(1000), blocked(1000), blocked(7000)] } });
    const id = await currentPromptId(approval);
    const error = await failureOf(approval.decide(session(), 'allow', id));
    expect(error.code).toBe('prompt-changed');
    expect(error.fix).toMatch(/nothing was typed/);
    expect(keyCalls()).toEqual([]);
    expect(audits.map((record) => record.phase)).toEqual(['intent', 'result']);
    expect(audits[1]?.outcome).toMatch(/^failed: prompt-changed/);
    // Nothing was typed: the prompt is free again.
    expect(audits[0]?.promptId).toBe(id);
  });

  it('refuses when the process of the terminal changed between the two looks (foreground pid is part of the identity)', async () => {
    const other = { ...blocked(1000), foreground: { pid: 99, name: 'claude.exe' } };
    const { approval, keyCalls } = setup({ ...BASE, get: { t2: [blocked(1000), blocked(1000), blocked(1000), blocked(1000), blocked(1000), other] } });
    const id = await currentPromptId(approval);
    expect((await failureOf(approval.decide(session(), 'allow', id))).code).toBe('no-terminal');
    expect(keyCalls()).toEqual([]);
  });

  it('a keys call that times out says the key may have been typed (effect unknown), keeps the prompt answered and audits it', async () => {
    const { approval, audits, keyCalls } = setup({ ...BASE, keys: { stdout: {}, delayMs: 8000 } }, { keysTimeoutMs: 2000 });
    const id = await currentPromptId(approval);
    const result = await approval.decide(session(), 'allow', id);
    expect(result).toMatchObject({ effect: 'unknown', statusAfter: 'unknown', keys: ['enter'] });
    expect(result.note).toMatch(/may or may not have been typed, check the terminal t2/);
    expect(audits.at(-1)?.outcome).toBe('unknown: hc-timeout');
    expect((await failureOf(approval.decide(session(), 'allow', id))).code).toBe('already-answered');
    expect(keyCalls()).toHaveLength(1);
  });

  it('an hc that cannot be read after the key was sent is effect unknown with the honest note, a result audit line, and no error', async () => {
    const { approval, audits } = setup({ ...BASE, afterKeys: { t2: { fail: true } } });
    const id = await currentPromptId(approval);
    const result = await approval.decide(session(), 'allow', id);
    expect(result.effect).toBe('unknown');
    expect(result.note).toMatch(/^the key was sent, check the terminal t2 \(it could not be read afterwards: .*hc is busy/);
    expect(audits.map((record) => [record.phase, record.outcome])).toEqual([
      ['intent', 'sending'],
      ['result', 'sent: unknown (terminal not readable afterwards)'],
    ]);
  });

  it('a very long dialog body is not offered (the page must show the whole text the hash covers)', async () => {
    const { approval, keyCalls } = setup({ ...BASE, read: { t2: dialogScreen({ command: 'x'.repeat(20_001) }) } });
    expect(await approval.read(session())).toMatchObject({ kind: 'unsupported', code: 'dialog-too-long', fix: expect.stringMatching(/in its terminal/) });
    expect(keyCalls()).toEqual([]);
  });

  it('truncates the command in the audit', async () => {
    const long = 'echo ' + 'x'.repeat(300);
    const { approval, audits } = setup({ ...BASE, read: { t2: dialogScreen({ command: long }) } });
    await approval.decide(session(), 'allow', await currentPromptId(approval));
    expect(audits[0]?.command.length).toBeLessThanOrEqual(80);
    expect(JSON.stringify(audits)).not.toContain('x'.repeat(100));
  });

  it('createHcApproval without an audit destination is refused at creation', () => {
    expect(() => createHcApproval({})).toThrow(/needs configDir/);
  });
});
