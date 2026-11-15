// FAKE inbox socket for the composer checks. Usage: node fake-pipe.mjs <sessionsDir> [pipeName]
// SAFETY: nothing here can reach a real Claude Code session. It listens on a pipe of its own (named pipe on Windows, a socket in the temp folder
// elsewhere), writes a fake token file, and points the FAKE registry sessions 1 and 3 of make-fake-sessions.mjs (agent-manager-owner, project-owner)
// at it, so a reply sent from the UI ends here. Every received line is printed. The registry edit is reverted when the process stops (stdin closed,
// SIGINT, SIGTERM). Do not point it at ~/.claude/sessions.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const sessionsDir = process.argv[2];
if (!sessionsDir) {
  throw new Error('Usage: node fake-pipe.mjs <sessionsDir> [pipeName]  (the FAKE registry folder made by make-fake-sessions.mjs)');
}
if (path.resolve(sessionsDir).toLowerCase().includes(`${path.sep}.claude${path.sep}sessions`)) {
  throw new Error(`Refusing ${sessionsDir}: it looks like the REAL Claude Code registry. Use a fake folder.`);
}
const name = process.argv[3] ?? `agent-manager-fake-${process.pid}`;
const pipePath = process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : path.join(os.tmpdir(), `am-${name.slice(-8)}.sock`);
const TOKEN = '0123456789abcdef0123456789abcdef';
const TARGETS = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000003'];

/** Same rule as agent-manager-core socketTransport.tokenFileName: <pid>.<sha256(path)>.key, the path lower-cased on Windows. */
function tokenFileName(pid, socketPath) {
  const hashed = process.platform === 'win32' ? socketPath.toLowerCase() : socketPath;
  return `${pid}.${createHash('sha256').update(hashed).digest('hex')}.key`;
}

const edited = [];
for (const file of fs.readdirSync(sessionsDir).filter((entry) => entry.endsWith('.json'))) {
  const full = path.join(sessionsDir, file);
  const original = fs.readFileSync(full, 'utf8');
  const entry = JSON.parse(original);
  if (!TARGETS.includes(entry.sessionId)) {
    continue;
  }
  fs.writeFileSync(full, JSON.stringify({ ...entry, messagingSocketPath: pipePath }));
  const token = path.join(sessionsDir, tokenFileName(entry.pid, pipePath));
  fs.writeFileSync(token, JSON.stringify({ peerToken: TOKEN }));
  edited.push({ full, original, token, id: entry.sessionId });
}
if (edited.length === 0) {
  throw new Error(`No fake session ${TARGETS.join(' or ')} in ${sessionsDir}: run make-fake-sessions.mjs first.`);
}

const server = net.createServer((socket) => {
  let buffer = '';
  console.log(`[fake-pipe] connection`);
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      // The auth line carries the token: never print it.
      console.log(`[fake-pipe] received ${line.includes('"type":"auth"') ? '{"type":"auth","token":"<hidden>"}' : line}`);
      newline = buffer.indexOf('\n');
    }
  });
  socket.on('error', () => undefined);
});

let stopped = false;
function stop() {
  if (stopped) {
    return;
  }
  stopped = true;
  for (const item of edited) {
    fs.writeFileSync(item.full, item.original);
    fs.rmSync(item.token, { force: true });
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.stdin.on('end', stop);
process.stdin.resume();

server.listen(pipePath, () => {
  console.log(`[fake-pipe] listening on ${pipePath}`);
  console.log(`[fake-pipe] sessions pointed at it: ${edited.map((item) => item.id).join(', ')}`);
  console.log('[fake-pipe] stops (and restores the registry files) when stdin closes, or on SIGINT/SIGTERM');
});
