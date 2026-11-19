// Talks NDJSON to the Claude Code supervisor control pipe that THIS research started (op ping / list / reply).
// Usage: node daemon-control.mjs <pipeName> <jsonFrameWithoutAuth> [--auth]
// --auth adds auth = contents of ~/.claude/daemon/control.key. Prints every line received for 3 s.
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [pipe, frameJson, flag] = process.argv.slice(2);
if (!pipe || !frameJson) throw new Error('usage: node daemon-control.mjs <pipePath> <json> [--auth]');
const frame = JSON.parse(frameJson);
if (flag === '--auth') frame.auth = fs.readFileSync(path.join(os.homedir(), '.claude', 'daemon', 'control.key'), 'utf8').trim();
const redacted = { ...frame, ...(frame.auth ? { auth: '<redacted>' } : {}) };
console.log('SEND', JSON.stringify(redacted));
const pipePath = pipe.startsWith('cc-') ? '\\\\.\\pipe\\' + pipe : pipe;
const sock = net.connect(pipePath);
sock.on('connect', () => sock.write(JSON.stringify(frame) + '\n'));
sock.on('data', (d) => console.log('RECV', d.toString().trim().slice(0, 1500)));
sock.on('error', (e) => console.log('ERROR', e.code, e.message));
setTimeout(() => { sock.destroy(); process.exit(0); }, 3000);
