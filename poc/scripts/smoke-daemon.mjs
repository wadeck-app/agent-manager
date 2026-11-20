// Smoke test of the BUILT bundle: one real Haiku session through the daemon API. Run once, by hand:
//   BUNDLE_VERSION=0.0.0-local npm run bundle   (in packages/agent-manager-cli)
//   node poc/scripts/smoke-daemon.mjs [path-to-agent-manager.cjs]
// Everything of agent-manager is isolated in a temp folder (AGENT_MANAGER_CONFIG_DIR with autoUpdate: false, XDG_CONFIG_HOME,
// AGENT_MANAGER_DAEMON_PORT on a free port, APP_CORE_PORT on a dead one, APP_CORE_CONFIG_DIR missing). HOME and USERPROFILE stay REAL on purpose: the
// claude child inherits the environment of the daemon and needs its real login and ~/.claude.json (measured: with a temp HOME it dies with
// "Claude configuration file not found", and CLAUDE_CONFIG_DIR=~/.claude makes it create ~/.claude/.claude.json). The session it runs is written under
// the real ~/.claude like any session of yours.
// Starts one daemon (detached) and stops it with `stop`; it never kills a process: if something stays, it prints the pid.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bundle = resolve(process.argv[2] ?? join(here, '../../packages/agent-manager-cli/dist-bundle/agent-manager.cjs'));

function freePort() {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => done(port));
    });
  });
}

const root = mkdtempSync(join(tmpdir(), 'agent-manager-smoke-'));
const configDir = join(root, 'config');
const project = join(root, 'project');
for (const dir of [configDir, project, join(root, 'xdg')]) {
  mkdirSync(dir, { recursive: true });
}
writeFileSync(join(configDir, 'config.yml'), 'autoUpdate: false\n');
const daemonPort = await freePort();
const deadPort = await freePort();
const env = {
  ...process.env,
  XDG_CONFIG_HOME: join(root, 'xdg'),
  AGENT_MANAGER_CONFIG_DIR: configDir,
  AGENT_MANAGER_DAEMON_PORT: String(daemonPort),
  APP_CORE_PORT: String(deadPort),
  APP_CORE_CONFIG_DIR: join(root, 'app-core-missing'),
};
console.log(`temp root (left in place, delete it by hand): ${root}`);
console.log(`bundle: ${bundle}\ncontrol port: ${daemonPort}, HOME/USERPROFILE: real (see the header)\n`);

function cli(...args) {
  const result = spawnSync(process.execPath, [bundle, ...args], { env, encoding: 'utf8', windowsHide: true, timeout: 90_000 });
  console.log(`$ agent-manager ${args.join(' ')}  -> exit ${result.status}`);
  if (result.stdout.trim() !== '') console.log(result.stdout.trimEnd());
  if (result.stderr.trim() !== '') console.log(`[stderr] ${result.stderr.trimEnd()}`);
  console.log('');
  return result;
}

let failed = false;
const fail = (text) => {
  failed = true;
  console.log(`FAIL: ${text}`);
};

try {
  const started = cli('start', '--detach');
  if (started.status !== 0) {
    throw new Error('start --detach failed');
  }
  const status = JSON.parse(cli('status', '--json').stdout);
  const token = readFileSync(join(configDir, 'health_token'), 'utf8').trim();
  const base = `http://127.0.0.1:${status.apiPort}`;
  const call = async (method, path, body) => {
    const response = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    return { status: response.status, body: text === '' ? undefined : JSON.parse(text) };
  };

  // The event stream, read in the background.
  const events = [];
  const controller = new AbortController();
  const stream = await fetch(`${base}/events`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
  console.log(`GET /events -> ${stream.status}`);
  const waiters = [];
  void (async () => {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for await (const chunk of stream.body) {
        buffer += decoder.decode(chunk, { stream: true });
        let index;
        while ((index = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const type = /^event: (.*)$/m.exec(block)?.[1];
          const data = /^data: (.*)$/m.exec(block)?.[1];
          if (type !== undefined && data !== undefined) {
            const event = { type, ...JSON.parse(data) };
            events.push(event);
            console.log(`  event ${event.id} ${event.type} ${JSON.stringify(event.data)}`);
            for (const waiter of [...waiters]) if (waiter.test(event)) waiter.done(event);
          }
        }
      }
    } catch {
      // The stream ends when the daemon stops or the controller aborts.
    }
  })();
  const waitFor = (test, what, ms = 180_000) =>
    new Promise((done, failWait) => {
      const found = events.find(test);
      if (found) return done(found);
      const timer = setTimeout(() => failWait(new Error(`timed out waiting for ${what}`)), ms);
      waiters.push({ test, done: (event) => { clearTimeout(timer); done(event); } });
    });

  const launched = await call('POST', '/sessions/launch', { hostKind: 'stream-json', cwd: project, model: 'haiku', permissionMode: 'default', name: 'smoke' });
  console.log(`POST /sessions/launch -> ${launched.status} ${JSON.stringify(launched.body)}\n`);
  if (launched.status !== 201) {
    throw new Error('launch failed');
  }
  const id = launched.body.session.id;
  const sent = await call('POST', `/sessions/${id}/send`, { text: 'Reply with the single word OK and nothing else. Do not use any tool.' });
  console.log(`POST /sessions/${id}/send -> ${sent.status} ${JSON.stringify(sent.body)}\n`);
  await waitFor((event) => event.type === 'session.result' || event.type === 'session.exit', 'the result or the exit of the session');
  await new Promise((done) => setTimeout(done, 1500));
  const view = await call('GET', `/sessions/${id}`);
  console.log(`\nGET /sessions/${id} -> ${view.status}\n${JSON.stringify(view.body.session, null, 2)}\n`);
  if (!events.some((event) => event.type === 'session.lifecycle' && event.data.uuid === sent.body.uuid && event.data.state === 'completed')) fail('the message did not reach the completed lifecycle');
  if (view.body.session.lastResult?.isError !== false) fail('the result is an error');
  if (!/OK/.test(view.body.session.lastResult?.text ?? '')) fail('the answer does not contain OK');
  controller.abort();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  cli('status');
  cli('stop');
  const after = cli('status');
  if (after.status !== 3) fail(`status after stop exited ${after.status}, expected 3: the daemon may still run (look at ${join(configDir, 'config.port')} for its pid; this script does not kill it)`);
  const logs = join(configDir, 'logs');
  try {
    for (const file of readdirSync(logs).filter((name) => name.startsWith('daemon-'))) {
      console.log(`--- ${file}\n${readFileSync(join(logs, file), 'utf8')}`);
    }
  } catch {
    console.log('(no daemon log)');
  }
  const audit = join(configDir, 'audit');
  try {
    for (const file of readdirSync(audit)) console.log(`--- audit/${file}\n${readFileSync(join(audit, file), 'utf8')}`);
  } catch {
    console.log('(no audit)');
  }
  try {
    console.log(`--- owned-sessions.json\n${readFileSync(join(configDir, 'owned-sessions.json'), 'utf8')}`);
  } catch {
    console.log('(no owned-sessions.json)');
  }
}
console.log(failed ? '\nSMOKE FAILED' : '\nSMOKE OK');
process.exitCode = failed ? 1 : 0;
