// Test-only fake of the background-session commands of `claude` (`--bg`, `agents --json [--all]`, `stop`, `respawn`, `rm`, `--version`). Never the real one.
// The "supervisor" is the JSON file FAKE_BG_STATE (required): every call is a new process, as with the real CLI. A test changes what `agents --json` says by
// editing that file ({ "agents": [...] }). Every call is appended to FAKE_BG_LOG (ndjson: argv, cwd) when it is set.
// Switches (environment): FAKE_BG_UNTRUSTED=1 (`--bg` exits 1 with "Workspace not trusted"), FAKE_BG_NO_OUTPUT=1 (`--bg` exits 0 and prints nothing),
// FAKE_BG_NEVER_LISTED=1 (`--bg` prints an id, the session never shows in `agents --json`), FAKE_BG_NO_SESSION_ID=1 (listed without a sessionId),
// FAKE_BG_HANG=<verb> (that verb never ends), FAKE_BG_FAIL=<verb> (that verb exits 2 with "fake failure of <verb>"), FAKE_BG_GARBAGE_LIST=1
// (`agents --json` prints a line that is not JSON), FAKE_BG_BAD_ENTRY=1 (`agents --json` also lists two entries that cannot be read), FAKE_BG_HUGE=1 (`agents --json` prints 17 MB),
// FAKE_BG_HOLD_PIPES=1 (`--bg` leaves a child that holds stdout open, like a supervisor would).
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';

const argv = process.argv.slice(2);
if (argv.includes('--version')) {
  process.stdout.write('9.9.9 (Claude Code fake bg)\n');
  process.exit(0);
}
const statePath = process.env.FAKE_BG_STATE;
if (!statePath) {
  throw new Error('fakeBgClaude: FAKE_BG_STATE is required');
}
if (process.env.FAKE_BG_LOG) {
  appendFileSync(process.env.FAKE_BG_LOG, `${JSON.stringify({ argv, cwd: process.cwd() })}\n`);
}
const read = () => (existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { agents: [] });
const write = (state) => writeFileSync(statePath, JSON.stringify(state));
const argOf = (name) => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};
const verb = argv[0];
if (process.env.FAKE_BG_HANG === verb || (process.env.FAKE_BG_HANG === '--bg' && argv.includes('--bg'))) {
  setInterval(() => undefined, 1000);
} else if (process.env.FAKE_BG_FAIL === verb) {
  process.stderr.write(`fake failure of ${verb}\n`);
  process.exit(2);
} else if (argv.includes('--bg')) {
  if (process.env.FAKE_BG_UNTRUSTED === '1') {
    process.stderr.write('Workspace not trusted. Run `claude` in this folder once and accept the trust prompt, then retry.\n');
    process.exit(1);
  }
  const id = randomBytes(4).toString('hex');
  const name = argOf('--name');
  const state = read();
  if (process.env.FAKE_BG_NEVER_LISTED !== '1') {
    state.agents.push({
      pid: 40000 + state.agents.length,
      id,
      cwd: process.cwd(),
      kind: 'background',
      startedAt: Date.now(),
      ...(process.env.FAKE_BG_NO_SESSION_ID === '1' ? {} : { sessionId: randomUUID() }),
      ...(name === undefined ? {} : { name }),
      status: 'idle',
      state: 'blocked',
    });
    write(state);
  }
  if (process.env.FAKE_BG_HOLD_PIPES === '1') {
    spawn(process.execPath, ['-e', 'setTimeout(() => undefined, 4000)'], { stdio: ['ignore', 'inherit', 'inherit'], detached: true, windowsHide: true }).unref();
  }
  if (process.env.FAKE_BG_NO_OUTPUT !== '1') {
    process.stdout.write(`Starting background service...\nbackgrounded · ${id}${name === undefined ? '' : ` · ${name}`}\n  claude agents             list sessions\n`);
  }
} else if (verb === 'agents') {
  if (process.env.FAKE_BG_HUGE === '1') {
    process.stdout.write(`[${' '.repeat(17 * 1024 * 1024)}]\n`);
  } else if (process.env.FAKE_BG_GARBAGE_LIST === '1') {
    process.stdout.write('not json at all\n');
  } else {
    const all = argv.includes('--all');
    // An interactive session is always listed (no id), a finished background one only with --all (as documented).
    const listed = read().agents.filter((agent) => all || (agent.state !== 'done' && agent.state !== 'stopped' && agent.state !== 'failed'));
    const broken = process.env.FAKE_BG_BAD_ENTRY === '1' ? [{ kind: 'background', id: '--force', cwd: 'x' }, { weird: true, kind: 'background' }, 7] : [];
    process.stdout.write(`${JSON.stringify([...broken, { pid: 1234, cwd: process.cwd(), kind: 'interactive', startedAt: 1, sessionId: randomUUID(), name: 'someone-else', status: 'idle' }, ...listed])}\n`);
  }
} else if (verb === 'stop' || verb === 'kill' || verb === 'respawn' || verb === 'rm') {
  const id = argv[1];
  const state = read();
  const agent = state.agents.find((entry) => entry.id === id);
  if (agent === undefined) {
    process.stderr.write(`no background session ${id}\n`);
    process.exit(1);
  }
  if (verb === 'rm') {
    state.agents = state.agents.filter((entry) => entry.id !== id);
  } else if (verb === 'respawn') {
    agent.state = 'blocked';
    agent.status = 'idle';
    agent.pid = 50000;
  } else {
    agent.state = 'stopped';
    delete agent.status;
    delete agent.pid;
    delete agent.waitingFor;
  }
  write(state);
  process.stdout.write(`${verb} ${id} ok\n`);
} else {
  process.stderr.write(`fakeBgClaude: unknown command ${argv.join(' ')}\n`);
  process.exit(64);
}
