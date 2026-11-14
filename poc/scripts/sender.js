'use strict';

// Minimal socket sender (own implementation of the contract: registry file -> socket path, <pid>.<sha256(lowercased path)>.key -> token).
// usage: node sender.js <sessionId> text <text>   |   node sender.js <sessionId> raw <json line>
// Refuses any session id that is not in results/spawned.json (safety: only PoC-spawned sessions).
// Prints ONE JSON line: timings (epoch ms) and process cost (peak RSS from process.resourceUsage().maxRSS, KB).

const startedAt = Date.now();
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const [sessionId, mode, payload] = process.argv.slice(2);
const fail = (m) => { console.error('sender: ' + m); process.exit(1); };
if (!sessionId || !mode || !payload) fail('usage: sender.js <sessionId> text|raw <payload>');

const spawned = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'results', 'spawned.json'), 'utf8'));
if (!spawned.some((s) => s.sessionId === sessionId)) fail('session ' + sessionId + ' was not spawned by the PoC: refusing to send');

const dir = path.join(os.homedir(), '.claude', 'sessions');
let entry = null;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
  try { const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (r.sessionId === sessionId) { entry = r; break; } } catch (_) { /* skip */ }
}
if (!entry || !entry.messagingSocketPath) fail('no registry entry / socket path for ' + sessionId);
const sp = entry.messagingSocketPath;
const hashed = process.platform === 'win32' ? sp.toLowerCase() : sp;
const keyFile = path.join(dir, entry.pid + '.' + crypto.createHash('sha256').update(hashed).digest('hex') + '.key');
let token;
try { token = JSON.parse(fs.readFileSync(keyFile, 'utf8')).peerToken; } catch (e) { fail('cannot read token file ' + keyFile + ': ' + e.message); }

const frame = mode === 'text' ? JSON.stringify({ type: 'user', message: { role: 'user', content: payload } }) : payload;
const beforeConnect = Date.now();
const socket = net.connect(sp);
socket.on('error', (e) => fail('socket error ' + e.code + ' on ' + sp));
socket.on('connect', () => {
  const connectedAt = Date.now();
  socket.write(JSON.stringify({ type: 'auth', token }) + '\n' + frame + '\n', () => {
    const wroteAt = Date.now();
    // The server never answers; keep the connection briefly (same 300 ms grace as the plugin sender)
    setTimeout(() => {
      socket.destroy();
      const endAt = Date.now();
      console.log(JSON.stringify({ startedAt, beforeConnect, connectedAt, wroteAt, endAt, wallMs: endAt - startedAt, wallMsWithoutGrace: wroteAt - startedAt, maxRSS_KB: process.resourceUsage().maxRSS, bytes: Buffer.byteLength(frame) }));
    }, 300);
  });
});
