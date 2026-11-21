// Live check of the X2 host (`claude --bg`) through the BUILT daemon bundle: ONE background Haiku session, at most 2 Haiku prompts, no loop. Run by hand:
//   BUNDLE_VERSION=0.0.0-local npm run bundle   (in packages/agent-manager-cli), and `npm run build` in packages/agent-manager-core
//   node poc/scripts/smoke-daemon-bg.mjs [path-to-agent-manager.cjs]
// Isolation like smoke-daemon.mjs: AGENT_MANAGER_CONFIG_DIR, XDG_CONFIG_HOME, AGENT_MANAGER_DAEMON_PORT, APP_CORE_PORT on dead ports in a temp root; HOME and
// USERPROFILE stay REAL (claude needs its login and ~/.claude.json). The session is a real one under the real ~/.claude.
// Folder: %TEMP%\am-bg first (an untrusted folder: the real error of `claude --bg` is recorded); when Claude Code refuses it, the already trusted
// %TEMP%\am-research2\proj is used (this script never edits ~/.claude.json).
// Replies go through the existing `socket` reply transport of the built core (the daemon has no pipe to a bg session). Never kills a process: the daemon is
// stopped with `stop`, the session with the daemon route (claude stop) then forgotten (claude rm); anything left is printed with its pid.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const bundle = resolve(process.argv[2] ?? join(here, '../../packages/agent-manager-cli/dist-bundle/agent-manager.cjs'));
const coreDist = join(here, '../../packages/agent-manager-core/dist');
const core = await import(pathToFileURL(join(coreDist, 'index.js')).href);
const reply = await import(pathToFileURL(join(coreDist, 'reply/index.js')).href);

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
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const stripAnsi = (text) => text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
const t0 = Date.now();
const stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1)}s`;

const root = mkdtempSync(join(tmpdir(), 'agent-manager-smoke-bg-'));
const configDir = join(root, 'config');
for (const dir of [configDir, join(root, 'xdg')]) mkdirSync(dir, { recursive: true });
writeFileSync(join(configDir, 'config.yml'), 'autoUpdate: false\n');
const untrusted = join(process.env.TEMP ?? tmpdir(), 'am-bg');
mkdirSync(untrusted, { recursive: true });
const trusted = join(process.env.TEMP ?? tmpdir(), 'am-research2', 'proj');
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
console.log(`temp root (left in place): ${root}\nbundle: ${bundle}\ncontrol port ${daemonPort}; HOME/USERPROFILE real; claude: ${spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout.trim()}\n`);

function cli(...args) {
  const result = spawnSync(process.execPath, [bundle, ...args], { env, encoding: 'utf8', windowsHide: true, timeout: 120_000 });
  console.log(`$ agent-manager ${args.join(' ')}  -> exit ${result.status}`);
  if (result.stdout.trim() !== '') console.log(result.stdout.trimEnd());
  if (result.stderr.trim() !== '') console.log(`[stderr] ${result.stderr.trimEnd()}`);
  return result;
}
function claude(...args) {
  const result = spawnSync('claude', args, { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
  return { code: result.status, out: stripAnsi(`${result.stdout}${result.stderr}`) };
}
const agentOf = (jobId) => {
  const run = claude('agents', '--json', '--all');
  if (run.code !== 0) return { error: run.out.slice(0, 300) };
  return JSON.parse(run.out).find((entry) => entry.id === jobId) ?? null;
};

let failed = false;
const fail = (text) => {
  failed = true;
  console.log(`FAIL: ${text}`);
};
let jobId;

try {
  if (cli('start', '--detach').status !== 0) throw new Error('start --detach failed');
  const status = JSON.parse(cli('status', '--json').stdout);
  const token = readFileSync(join(configDir, 'health_token'), 'utf8').trim();
  const base = `http://127.0.0.1:${status.apiPort}`;
  const call = async (method, path, body) => {
    const response = await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text();
    return { status: response.status, body: text === '' ? undefined : JSON.parse(text) };
  };
  const events = [];
  const controller = new AbortController();
  const stream = await fetch(`${base}/events`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
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
            console.log(`  ${stamp()} event ${event.id} ${event.type} ${JSON.stringify(event.data)}`);
            for (const waiter of [...waiters]) if (waiter.test(event)) waiter.done(event);
          }
        }
      }
    } catch {
      // The stream ends when the daemon stops or the controller aborts.
    }
  })();
  const waitFor = (test, what, ms) =>
    new Promise((done, failWait) => {
      const found = events.find(test);
      if (found) return done(found);
      const timer = setTimeout(() => failWait(new Error(`timed out waiting for ${what}`)), ms);
      waiters.push({ test, done: (event) => { clearTimeout(timer); done(event); } });
    });

  // 1. launch: the untrusted folder first (free: no model call)
  let cwd = untrusted;
  let launched = await call('POST', '/sessions/launch', { hostKind: 'bg', cwd, model: 'haiku', permissionMode: 'default', name: 'am-bg-smoke' });
  console.log(`\nPOST /sessions/launch (untrusted ${cwd}) -> ${launched.status} ${JSON.stringify(launched.body)}\n`);
  if (launched.status !== 201) {
    if (launched.body?.error?.code !== 'workspace-not-trusted') throw new Error('launch failed with something else than the trust refusal');
    if (!existsSync(trusted)) throw new Error(`the trusted folder ${trusted} does not exist`);
    cwd = trusted;
    launched = await call('POST', '/sessions/launch', { hostKind: 'bg', cwd, model: 'haiku', permissionMode: 'default', name: 'am-bg-smoke' });
    console.log(`POST /sessions/launch (trusted ${cwd}) -> ${launched.status} ${JSON.stringify(launched.body)}\n`);
    if (launched.status !== 201) throw new Error('launch failed');
  }
  const id = launched.body.session.id;
  jobId = launched.body.session.jobId;
  console.log(`session ${id}, job ${jobId}, attach: ${launched.body.session.attachCommand}`);
  console.log(`agents --json entry: ${JSON.stringify(agentOf(jobId))}`);

  // 2. the registry entry and the reply transport
  const registry = await core.readSessionRegistry(join(homedir(), '.claude', 'sessions'));
  const session = registry.ok ? registry.sessions.find((entry) => entry.sessionId === id) : undefined;
  if (session === undefined) throw new Error('the bg session is not in the Claude Code registry');
  console.log(`registry: ${JSON.stringify({ kind: session.kind, entrypoint: session.entrypoint, status: session.status, name: session.name, hasSocket: session.messagingSocketPath !== undefined })}`);
  const socket = reply.createSocketTransport();
  const probe = await socket.probe(session, { permissionMode: 'default' });
  console.log(`socket probe: available=${probe.available} reason=${probe.reason} fix=${probe.fix}`);
  if (!probe.available) throw new Error('the socket transport is not available for the bg session');

  const send = async (text, label) => {
    const result = await socket.send(session, { id: `bgsmoke${label}${Date.now()}`, text, imagePaths: [], priority: 'next', origin: 'web' });
    console.log(`${stamp()} socket send (${label}) -> ${JSON.stringify(result)}`);
  };

  // 3. prompt 1: a plain answer; the daemon state is observed through its own poll (5 s)
  await send('Reply with the single word OK and nothing else. Do not use any tool.', 'p1');
  const seen = [];
  for (let i = 0; i < 40; i++) {
    const view = (await call('GET', `/sessions/${id}`)).body.session;
    if (seen.at(-1) !== `${view.state}/${view.bgState}`) {
      seen.push(`${view.state}/${view.bgState}`);
      console.log(`${stamp()} daemon view: state=${view.state} bgState=${view.bgState} waitingFor=${view.waitingFor ?? '-'}`);
    }
    if (seen.includes('running/working') && view.state === 'idle') break;
    await sleep(3000);
  }
  console.log(`state sequence after prompt 1: ${seen.join(' -> ')}`);
  if (!seen.some((entry) => entry.startsWith('running/'))) fail('the daemon never saw the session running (poll interval 5 s: a turn shorter than that can be missed, see the sequence)');
  console.log(`agents --json entry: ${JSON.stringify(agentOf(jobId))}`);

  // 4. prompt 2: a tool call in default mode, to see the permission wait the UI shows
  await send('Run exactly this Bash command and nothing else: touch am-bg-touch.txt . Then reply DONE.', 'p2');
  let waiting = null;
  try {
    waiting = await waitFor((event) => event.type === 'session.bg_waiting' && event.sessionId === id, 'session.bg_waiting', 120_000);
  } catch (error) {
    console.log(`no permission wait seen: ${error.message}`);
  }
  console.log(`bg_waiting: ${JSON.stringify(waiting)}`);
  console.log(`daemon view: ${JSON.stringify((await call('GET', `/sessions/${id}`)).body.session)}`);
  console.log(`agents --json entry: ${JSON.stringify(agentOf(jobId))}`);
  console.log(`claude logs (last 500 chars, ANSI stripped): ${claude('logs', jobId).out.replace(/\s+/g, ' ').slice(-500)}`);
  for (const [path, body] of [[`/sessions/${id}/interrupt`, undefined], [`/sessions/${id}/permissions`, undefined]]) {
    const refused = await call(path.endsWith('permissions') ? 'GET' : 'POST', path, body);
    console.log(`${path} -> ${refused.status} ${JSON.stringify(refused.body?.error ?? refused.body)}`);
  }

  // 5. stop (claude stop), check, forget (claude rm), check
  const stopped = await call('POST', `/sessions/${id}/stop`);
  console.log(`\nPOST stop -> ${stopped.status} state=${stopped.body?.session?.state} resumable=${stopped.body?.session?.resumable}`);
  console.log(`agents --json entry after stop: ${JSON.stringify(agentOf(jobId))}`);
  const forgotten = await call('POST', `/sessions/${id}/forget`);
  console.log(`POST forget -> ${forgotten.status} ${JSON.stringify(forgotten.body)}`);
  const after = agentOf(jobId);
  console.log(`agents --json entry after forget: ${JSON.stringify(after)}`);
  if (after !== null) fail('the session is still listed by claude agents after forget');
  controller.abort();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
  if (jobId !== undefined) {
    console.log(`left running? the job ${jobId} may still exist: check "claude agents", stop it with "claude stop ${jobId}" and remove it with "claude rm ${jobId}"`);
  }
} finally {
  cli('stop');
  const after = cli('status');
  if (after.status !== 3) fail(`status after stop exited ${after.status}, expected 3: the daemon may still run (see ${join(configDir, 'config.port')}; this script does not kill it)`);
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
  await sleep(8000);
  console.log(`--- claude daemon status (8 s after the end)\n${claude('daemon', 'status').out.trim()}`);
}
console.log(failed ? '\nSMOKE FAILED' : '\nSMOKE OK');
process.exitCode = failed ? 1 : 0;
