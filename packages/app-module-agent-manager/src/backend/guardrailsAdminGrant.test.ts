import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GuardrailsAdminError, grantBypass, listBypasses, listRules } from './guardrailsAdmin.js';

// grant and rules of the admin CLI (threat-model T-23), and the optional fields of the list. The fake script is testSupport/fakeAdmin.cjs.
const FAKE = fileURLToPath(new URL('./testSupport/fakeAdmin.cjs', import.meta.url));
const SESSION = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'tok-SECRET.abc_123-xyz';

const entry = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  category: 'rm',
  mode: 'once',
  session_id: SESSION,
  expires: new Date(Date.now() + 600_000).toISOString(),
  remaining_ms: 600_000,
  uses_left: 1,
  reason: 'clean',
  ...extra,
});

let box: string;
const saved: Record<string, string | undefined> = {};
function setEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in saved)) {
      saved[key] = process.env[key];
    }
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

beforeEach(() => {
  box = mkdtempSync(join(tmpdir(), 'am-admin-grant-'));
  mkdirSync(join(box, 'project'));
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  rmSync(box, { recursive: true, force: true });
});

function useFake(scenario: string, grants: Record<string, unknown>[] = []): { argvs: () => string[][] } {
  const grantsFile = join(box, 'grants.json');
  writeFileSync(grantsFile, JSON.stringify(grants));
  const logFile = join(box, 'calls.log');
  writeFileSync(logFile, '');
  setEnv({ FAKE_ADMIN_SCENARIO: scenario, FAKE_ADMIN_GRANTS_FILE: grantsFile, FAKE_ADMIN_LOG: logFile });
  return { argvs: () => rawCalls().map((call) => call.argv) };
}

interface RawCall {
  argv: string[];
  stdin: string;
  tokenInEnv: boolean;
}

function rawCalls(): RawCall[] {
  return readFileSync(join(box, 'calls.log'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as RawCall);
}

async function failure(run: Promise<unknown>): Promise<GuardrailsAdminError> {
  try {
    await run;
  } catch (error) {
    expect(error).toBeInstanceOf(GuardrailsAdminError);
    return error as GuardrailsAdminError;
  }
  throw new Error('expected a GuardrailsAdminError, the call succeeded');
}

const cwd = (): string => join(box, 'project');
const grantArgs = (): Parameters<typeof grantBypass>[0] => ({ script: FAKE, cwd: cwd(), sessionId: SESSION, category: 'rm', mode: '10m', rationale: 'clean the build folder', token: TOKEN });

describe('listBypasses: the optional fields of the contract', () => {
  it('reads origin and uses_left; a grant without origin has origin null', async () => {
    useFake('ok', [entry('a1b2c3d4', { origin: 'ui' }), entry('b2c3d4e5', { uses_left: null, mode: 'ttl' })]);
    const result = await listBypasses({ script: FAKE, cwd: cwd(), sessionId: SESSION });
    expect(result.grants.map((g) => [g.origin, g.usesLeft])).toEqual([
      ['ui', 1],
      [null, null],
    ]);
  });

  it('an origin that is not text or null is a bad-output, never shown', async () => {
    useFake('ok', [entry('a1b2c3d4', { origin: 7 })]);
    const problem = await failure(listBypasses({ script: FAKE, cwd: cwd(), sessionId: SESSION }));
    expect(problem.code).toBe('bad-output');
    expect(problem.message).toMatch(/origin/);
  });
});

describe('grantBypass: the token goes to stdin only', () => {
  it('runs bypass grant with the flags of the contract, the token on stdin and NOTHING secret in argv or env', async () => {
    useFake('ok', []);
    const result = await grantBypass(grantArgs());
    expect(result).toMatchObject({ id: 'c0ffee01', category: 'rm', mode: '10m', sessionId: SESSION, origin: 'ui' });
    expect(Date.parse(result.expires)).toBeGreaterThan(Date.now());
    const calls = rawCalls();
    expect(calls).toHaveLength(1);
    const call = calls[0] as RawCall;
    expect(call.argv).toEqual(['bypass', 'grant', '--cwd', cwd(), '--category', 'rm', '--mode', '10m', '--session', SESSION, '--rationale', 'clean the build folder', '--json']);
    expect(call.stdin).toBe(TOKEN);
    expect(call.argv.join(' ')).not.toContain(TOKEN);
    // The child saw no environment value that holds the token (the fake checks its own environment), and neither does this process.
    expect(call.tokenInEnv).toBe(false);
    expect(Object.values(process.env).join('\n')).not.toContain(TOKEN);
  });

  it.each([
    ['grant-elevation', /elevation-required/],
    ['grant-pin-not-set', /pin-not-set/],
    ['grant-unreachable', /unreachable/],
    ['grant-spam', /Spam lock/],
    ['grant-not-bypassable', /not bypassable/],
  ])('%s is a plugin-error carrying the plugin text', async (scenario, message) => {
    useFake(scenario, []);
    const problem = await failure(grantBypass(grantArgs()));
    expect(problem.code).toBe('plugin-error');
    expect(problem.message).toMatch(message);
  });

  it('a plugin that echoes the token in its error does not get it into the message, the hint or the stderr tail', async () => {
    useFake('grant-echo-token', []);
    const problem = await failure(grantBypass(grantArgs()));
    expect(problem.code).toBe('plugin-error');
    expect(problem.message).toMatch(/the token \[token removed\] was rejected/);
    expect(JSON.stringify([problem.message, problem.hint, problem.stderrTail])).not.toContain(TOKEN);
  });

  it('refuses an empty token before any process runs', async () => {
    useFake('ok', []);
    await expect(grantBypass({ ...grantArgs(), token: '' })).rejects.toThrowError(/token/);
    expect(rawCalls()).toEqual([]);
  });

  it('a grant answered for another category is a bad-output that says the grant may exist', async () => {
    useFake('grant-wrong-category', []);
    const problem = await failure(grantBypass(grantArgs()));
    expect(problem.code).toBe('bad-output');
    expect(problem.message).toMatch(/kill/);
    expect(problem.message).toMatch(/may have been created/);
  });

  it('an error JSON on exit 0 is a bad-output (never read as a grant), an unknown schema too', async () => {
    useFake('error-as-success', []);
    expect((await failure(grantBypass(grantArgs()))).code).toBe('bad-output');
    useFake('bad-schema', []);
    expect((await failure(grantBypass(grantArgs()))).code).toBe('bad-output');
  });

  it('times out like the other calls', async () => {
    useFake('hang', []);
    expect((await failure(grantBypass({ ...grantArgs(), timeoutMs: 300 }))).code).toBe('timeout');
  });
});

describe('listRules', () => {
  it('runs rules --cwd <dir> --json and maps the categories and the config block', async () => {
    const calls = useFake('ok', []);
    const result = await listRules({ script: FAKE, cwd: cwd() });
    expect(calls.argvs()).toEqual([['rules', '--cwd', cwd(), '--json']]);
    expect(result.config).toEqual({ path: `${cwd()}/.claude/guardrails.json`, present: false, error: null });
    expect(result.categories.find((c) => c.name === 'git-push')).toEqual({ name: 'git-push', decision: 'ask', source: 'config', bypassable: true, hardcoded: false });
    expect(result.categories.find((c) => c.name === 'ssh-config')?.bypassable).toBe(false);
  });

  it('keeps the config error text', async () => {
    useFake('ok', []);
    setEnv({ FAKE_ADMIN_RULES_CONFIG_ERROR: 'guardrails.json line 3: unexpected token' });
    expect((await listRules({ script: FAKE, cwd: cwd() })).config.error).toBe('guardrails.json line 3: unexpected token');
  });

  it('a decision outside allow|ask|deny, a source outside the three, or a non-boolean is a bad-output', async () => {
    useFake('ok', []);
    for (const category of [
      { name: 'rm', decision: 'maybe', source: 'default', bypassable: true, hardcoded: false },
      { name: 'rm', decision: 'deny', source: 'user', bypassable: true, hardcoded: false },
      { name: 'rm', decision: 'deny', source: 'default', bypassable: 'yes', hardcoded: false },
    ]) {
      const file = join(box, 'rules.json');
      writeFileSync(file, JSON.stringify([category]));
      setEnv({ FAKE_ADMIN_RULES_FILE: file });
      expect((await failure(listRules({ script: FAKE, cwd: cwd() }))).code).toBe('bad-output');
    }
  });

  it('an unknown schema is a loud failure', async () => {
    useFake('bad-schema', []);
    expect((await failure(listRules({ script: FAKE, cwd: cwd() }))).code).toBe('bad-output');
  });
});
