import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { removeDir } from '../testFixtures.js';
import { HcControl, buildKeysArgs, promptDraft } from './HcControl.js';
import { LaunchError } from './errors.js';

const FAKE_HC = fileURLToPath(new URL('./testSupport/fakeHcRun.mjs', import.meta.url));
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    removeDir(dir);
  }
});

function setup(scenario: Record<string, unknown>): { control: HcControl; calls: () => { argv: string[] }[] } {
  const dir = mkdtempSync(join(tmpdir(), 'agent-manager-hccontrol-'));
  dirs.push(dir);
  const scenarioFile = join(dir, 'scenario.json');
  const log = join(dir, 'calls.ndjson');
  writeFileSync(scenarioFile, JSON.stringify(scenario));
  const env = { ...process.env, FAKE_HC_SCENARIO: scenarioFile, FAKE_HC_LOG: log };
  const control = new HcControl({ command: process.execPath, commandArgs: [FAKE_HC], env: () => env, timeoutMs: 5000 });
  return { control, calls: () => (existsSync(log) ? readFileSync(log, 'utf8') : '').split('\n').filter(Boolean).map((line) => JSON.parse(line) as { argv: string[] }) };
}

async function rejection(work: Promise<unknown>): Promise<LaunchError> {
  try {
    await work;
  } catch (error) {
    if (error instanceof LaunchError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a LaunchError, the call succeeded');
}

describe('HcControl.get', () => {
  it('reads the foreground pid, the status and whether the terminal is finished', async () => {
    const { control } = setup({ get: { t5: [{ address: 't5', foreground: { pid: 4242 }, status: { state: 'blocked', kind: 'question' }, finished_ms: null, exit_code: null, reason: null }] } });
    expect(await control.get('t5')).toEqual({ address: 't5', finished: false, foregroundPid: 4242, state: 'blocked', kind: 'question', exitCode: null, reason: null });
  });

  it('a terminal with finished_ms is finished, with its exit code and reason', async () => {
    const { control } = setup({ get: { t5: [{ address: 't5', finished_ms: 1700000000000, exit_code: 1, reason: 'killed' }] } });
    expect(await control.get('t5')).toMatchObject({ finished: true, exitCode: 1, reason: 'killed' });
  });

  it('a terminal hc does not know is undefined (not an error: it may have been removed)', async () => {
    const { control } = setup({});
    expect(await control.get('t9')).toBeUndefined();
  });

  it('any other failure of hc is a LaunchError with the fix', async () => {
    const { control } = setup({ get: { t5: [{ plain: 'boom', exit: 1 }] } });
    const error = await rejection(control.get('t5'));
    expect(error.code).toBe('hc-control-failed');
    expect(error.fix).toContain('hc server status');
  });
});

describe('HcControl commands', () => {
  it('keys passes the terminal and the keys as arguments, after "--", never --force', async () => {
    const { control, calls } = setup({});
    await control.keys('t5', ['ctrl+c', 'ctrl+c']);
    expect(calls().map((call) => call.argv)).toEqual([['keys', '--json', '--', 't5', 'ctrl+c', 'ctrl+c']]);
    expect(buildKeysArgs('t5', ['enter'])).toEqual(['keys', '--json', '--', 't5', 'enter']);
  });

  it('kill and the removal of a finished terminal take the address only', async () => {
    const { control, calls } = setup({});
    await control.kill('t5');
    await control.remove('t5');
    expect(calls().map((call) => call.argv)).toEqual([
      ['kill', '--json', '--', 't5'],
      ['rm', '--json', '--', 't5'],
    ]);
  });

  it('refuses an address that is not a terminal address, before running hc', async () => {
    const { control, calls } = setup({});
    const error = await rejection(control.kill('--force'));
    expect(error.code).toBe('invalid-terminal-address');
    expect(calls()).toEqual([]);
  });

  it('a refusal of hc names what hc said', async () => {
    const { control } = setup({ rm: { exit: 1, stdout: { error: { kind: 'still_live', message: 'terminal t5 is live', hint: 'hc kill it first' } } } });
    const error = await rejection(control.remove('t5'));
    expect(error.code).toBe('hc-control-failed');
    expect(error.reason).toContain('terminal t5 is live');
  });
});

describe('HcControl.screen and promptDraft (what is typed in the prompt of an idle claude, #71 item 8)', () => {
  it('reads the screen text of the terminal with hc read --json, the address after --', async () => {
    const { control, calls } = setup({ read: { t5: { complete: true, how: 'screen', text: 'hello\n' } } });
    expect(await control.screen('t5')).toBe('hello\n');
    expect(calls()[0]?.argv).toEqual(['read', '--json', '--', 't5']);
  });

  it('a terminal hc does not know is an error with the fix, never an empty screen', async () => {
    const { control } = setup({});
    expect((await rejection(control.screen('t5'))).code).toBe('hc-control-failed');
  });

  it('the prompt box is the last prompt line right under a rule: empty = no draft, text = the draft (earlier lines starting with the prompt mark are the history)', () => {
    const rule = '\u2500'.repeat(40);
    const history = '\u276F first message\n  answer\n\n\u276F second message\n';
    expect(promptDraft(`${history}${rule}\n\u276F \n${rule}\n  status line`)).toEqual({ found: true, draft: '' });
    expect(promptDraft(`${history}${rule}\n\u276F half typed thought\n${rule}\n  status line`)).toEqual({ found: true, draft: 'half typed thought' });
  });

  it('a screen without a prompt box is reported as not found (a dialog, a different layout), never read as empty', () => {
    expect(promptDraft('Do you trust the files in this folder?\n1. Yes\n2. No')).toEqual({ found: false });
    expect(promptDraft('')).toEqual({ found: false });
  });
});
