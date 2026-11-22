import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GuardrailsAdminError, adminOverrideEnv, listBypasses, resolveAdminScript, revokeBypass } from './guardrailsAdmin.js';

const FAKE = fileURLToPath(new URL('./testSupport/fakeAdmin.cjs', import.meta.url));
const SESSION = '11111111-1111-4111-8111-111111111111';
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
  box = mkdtempSync(join(tmpdir(), 'am-admin-'));
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

function useFake(scenario: string, grants: Record<string, unknown>[] = []): { log: () => string[][] } {
  const grantsFile = join(box, 'grants.json');
  writeFileSync(grantsFile, JSON.stringify(grants));
  const logFile = join(box, 'calls.log');
  setEnv({ FAKE_ADMIN_SCENARIO: scenario, FAKE_ADMIN_GRANTS_FILE: grantsFile, FAKE_ADMIN_LOG: logFile });
  return {
    log: () =>
      readFileSync(logFile, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => (JSON.parse(line) as { argv: string[] }).argv),
  };
}

const opts = (): { script: string } => ({ script: FAKE });

async function failure(run: Promise<unknown>): Promise<GuardrailsAdminError> {
  try {
    await run;
  } catch (error) {
    expect(error).toBeInstanceOf(GuardrailsAdminError);
    return error as GuardrailsAdminError;
  }
  throw new Error('expected a GuardrailsAdminError, the call succeeded');
}

describe('resolveAdminScript', () => {
  const pluginDir = (home: string): string => join(home, '.claude', 'plugins', 'cache', 'local-marketplace', 'w-guardrails');
  function version(home: string, name: string, withAdmin: boolean): string {
    const scripts = join(pluginDir(home), name, 'scripts');
    mkdirSync(scripts, { recursive: true });
    const file = join(scripts, 'admin.js');
    if (withAdmin) {
      writeFileSync(file, '// admin');
    }
    return file;
  }

  it('picks the highest version by NUMERIC comparison (1.29.0 beats 1.9.0 and 1.3.10)', () => {
    setEnv({ [adminOverrideEnv]: undefined });
    version(box, '1.9.0', true);
    version(box, '1.3.10', true);
    const highest = version(box, '1.29.0', true);
    expect(resolveAdminScript({ homeDir: box })).toBe(highest);
  });

  it('says where it looked when the plugin is not installed', () => {
    setEnv({ [adminOverrideEnv]: undefined });
    let problem: GuardrailsAdminError | undefined;
    try {
      resolveAdminScript({ homeDir: box });
    } catch (caught) {
      problem = caught as GuardrailsAdminError;
    }
    expect(problem?.code).toBe('not-installed');
    expect(problem?.message).toBe(`w-guardrails is not installed (looked in ${pluginDir(box)})`);
    expect(problem?.hint).toMatch(/install the w-guardrails plugin/i);
  });

  it('a highest version without scripts/admin.js is said (code not-installed: the old reader takes over), never silently replaced by an older version', () => {
    setEnv({ [adminOverrideEnv]: undefined });
    version(box, '1.0.0', true);
    version(box, '1.30.0', false);
    let problem: GuardrailsAdminError | undefined;
    try {
      resolveAdminScript({ homeDir: box });
    } catch (caught) {
      problem = caught as GuardrailsAdminError;
    }
    expect(problem?.code).toBe('not-installed');
    expect(problem?.message).toMatch(/1\.30\.0.*has no scripts[\\/]admin\.js/s);
    expect(problem?.hint).toMatch(/update/i);
  });

  it('the override env var wins, and a path that is not a file is an error naming the variable', () => {
    setEnv({ [adminOverrideEnv]: FAKE });
    expect(resolveAdminScript({ homeDir: box })).toBe(FAKE);
    setEnv({ [adminOverrideEnv]: join(box, 'nope.js') });
    expect(() => resolveAdminScript({ homeDir: box })).toThrowError(new RegExp(`${adminOverrideEnv}.*nope\\.js`, 's'));
  });
});

describe('listBypasses', () => {
  it('runs node with an argv array: bypass list --cwd <dir> --session <id> --json, and maps the grants', async () => {
    const calls = useFake('ok', [entry('a1b2c3d4'), entry('b2c3d4e5', { session_id: 'other' })]);
    const cwd = join(box, 'project');
    const result = await listBypasses({ ...opts(), cwd, sessionId: SESSION });
    expect(calls.log()).toEqual([['bypass', 'list', '--cwd', cwd, '--session', SESSION, '--json']]);
    expect(result.cwd).toBe(cwd);
    expect(result.grants).toEqual([{ id: 'a1b2c3d4', category: 'rm', mode: 'once', sessionId: SESSION, expires: expect.any(String), remainingMs: 600_000, usesLeft: 1, reason: 'clean', origin: null }]);
  });

  it('an empty list is a valid answer (no grant)', async () => {
    useFake('ok', []);
    expect((await listBypasses({ ...opts(), cwd: join(box, 'project'), sessionId: SESSION })).grants).toEqual([]);
  });

  it('a corrupt state file is the plugin message with a fix, never an empty list', async () => {
    useFake('corrupt');
    const problem = await failure(listBypasses({ ...opts(), cwd: join(box, 'project'), sessionId: SESSION }));
    expect(problem.code).toBe('plugin-error');
    expect(problem.message).toMatch(/not valid JSON/);
    expect(problem.hint).not.toBe('');
  });

  it.each([
    ['bad-schema', 'bad-output', /unknown schema.*bypass-list\/2.*bypass-list\/1/is],
    ['no-schema', 'bad-output', /no 'schema'/i],
    ['not-json', 'bad-output', /not JSON/i],
    ['wrong-type', 'bad-output', /remaining_ms.*number/is],
    ['error-as-success', 'bad-output', /schema/i],
  ])('%s is a loud error', async (scenario, code, message) => {
    useFake(scenario);
    const problem = await failure(listBypasses({ ...opts(), cwd: join(box, 'project'), sessionId: SESSION }));
    expect(problem.code).toBe(code);
    expect(problem.message).toMatch(message);
    expect(problem.hint).not.toBe('');
  });

  it('exit 2 is a usage error (the module and the plugin disagree), with the stderr tail and the fix', async () => {
    useFake('usage');
    const problem = await failure(listBypasses({ ...opts(), cwd: join(box, 'project'), sessionId: SESSION }));
    expect(problem.code).toBe('usage');
    expect(problem.message).toMatch(/exit code 2/);
    expect(problem.stderrTail).toMatch(/Unknown flag/);
    expect(problem.hint).toMatch(/update/i);
  });

  it('an exit code outside the contract is an error with the stderr tail', async () => {
    useFake('exit7');
    const problem = await failure(listBypasses({ ...opts(), cwd: join(box, 'project'), sessionId: SESSION }));
    expect(problem.code).toBe('exit-code');
    expect(problem.message).toMatch(/exit code 7/);
    expect(problem.stderrTail).toMatch(/something unexpected/);
  });

  it('a call that does not end is killed at the timeout', async () => {
    useFake('hang');
    const problem = await failure(listBypasses({ ...opts(), cwd: join(box, 'project'), sessionId: SESSION, timeoutMs: 400 }));
    expect(problem.code).toBe('timeout');
    expect(problem.message).toMatch(/did not answer within 0\.4 s/);
  });

  it('an output above the cap is cut and refused', async () => {
    useFake('huge');
    const problem = await failure(listBypasses({ ...opts(), cwd: join(box, 'project'), sessionId: SESSION }));
    expect(problem.code).toBe('output-too-large');
    expect(problem.message).toMatch(/1 MiB/);
  });

  it('a script that is not there fails with its path (node exits 1: MODULE_NOT_FOUND on stderr)', async () => {
    const problem = await failure(listBypasses({ script: join(box, 'missing.js'), cwd: join(box, 'project'), sessionId: SESSION }));
    expect(problem.code).toBe('exit-code');
    expect(problem.stderrTail).toMatch(/missing\.js/);
  });

  it('a cwd that does not exist is the plugin error', async () => {
    useFake('ok');
    const problem = await failure(listBypasses({ ...opts(), cwd: join(box, 'gone'), sessionId: SESSION }));
    expect(problem.code).toBe('plugin-error');
    expect(problem.message).toMatch(/does not exist/);
  });
});

describe('revokeBypass', () => {
  it('runs bypass revoke --id <id> --cwd <dir> --json (no --session: the plugin refuses it) and returns the removed grant', async () => {
    const calls = useFake('ok', [entry('a1b2c3d4')]);
    const cwd = join(box, 'project');
    const result = await revokeBypass({ ...opts(), cwd, id: 'a1b2c3d4' });
    expect(calls.log()).toEqual([['bypass', 'revoke', '--id', 'a1b2c3d4', '--cwd', cwd, '--json']]);
    expect(result).toEqual({ id: 'a1b2c3d4', category: 'rm', sessionId: SESSION });
  });

  it('an unknown id is the plugin error', async () => {
    useFake('ok', []);
    const problem = await failure(revokeBypass({ ...opts(), cwd: join(box, 'project'), id: 'deadbeef' }));
    expect(problem.code).toBe('plugin-error');
    expect(problem.message).toMatch(/No grant with id "deadbeef"/);
  });

  it('an answer for another id than the one asked is refused, not reported as done', async () => {
    useFake('revoke-mismatch', [entry('a1b2c3d4')]);
    const problem = await failure(revokeBypass({ ...opts(), cwd: join(box, 'project'), id: 'a1b2c3d4' }));
    expect(problem.code).toBe('bad-output');
    expect(problem.message).toMatch(/ffffffff.*a1b2c3d4/s);
  });

  it('an answer that is not a revoke answer is refused', async () => {
    useFake('not-json');
    expect((await failure(revokeBypass({ ...opts(), cwd: join(box, 'project'), id: 'a1b2c3d4' }))).code).toBe('bad-output');
  });
});

// The REAL admin.js of the installed plugin, read-only: `bypass list` on an empty temp folder, and a revoke of an id that does not exist (proves the error JSON).
// Off by default: it needs the plugin installed on the machine. The tests redirect HOME, so the real home must be given:
//   AGENT_MANAGER_INTEGRATION=1 AGENT_MANAGER_INTEGRATION_HOME="$USERPROFILE" npx vitest run --project backend src/backend/guardrailsAdmin.test.ts
const integration = process.env['AGENT_MANAGER_INTEGRATION'] === '1';
describe.skipIf(!integration)('the REAL admin.js (skipped: set AGENT_MANAGER_INTEGRATION=1 and AGENT_MANAGER_INTEGRATION_HOME to run it)', () => {
  function realScript(): string {
    const home = process.env['AGENT_MANAGER_INTEGRATION_HOME'];
    if (home === undefined || home === '') {
      throw new Error('AGENT_MANAGER_INTEGRATION=1 needs AGENT_MANAGER_INTEGRATION_HOME (your real home folder: the test environment redirects HOME).');
    }
    setEnv({ [adminOverrideEnv]: undefined });
    return resolveAdminScript({ homeDir: home });
  }

  it('lists nothing for a folder without bypass file, and answers the error JSON for an unknown id', async () => {
    const script = realScript();
    const cwd = join(box, 'project');
    const listed = await listBypasses({ script, cwd, sessionId: SESSION });
    expect(listed.grants).toEqual([]);
    expect(listed.cwd.toLowerCase()).toBe(cwd.toLowerCase());
    const problem = await failure(revokeBypass({ script, cwd, id: 'deadbeef' }));
    expect(problem.code).toBe('plugin-error');
    expect(problem.message).toMatch(/deadbeef/);
  });
});
