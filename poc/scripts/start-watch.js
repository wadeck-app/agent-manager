'use strict';
// Starts registry-watch.js detached and hidden, records its pid in results/spawned.json.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const RES = path.join(__dirname, '..', 'results');
const stop = path.join(RES, 'registry-watch.stop');
if (fs.existsSync(stop)) fs.unlinkSync(stop);
const child = spawn(process.execPath, [path.join(__dirname, 'registry-watch.js')], { detached: true, stdio: 'ignore', windowsHide: true });
child.unref();
const sp = path.join(RES, 'spawned.json');
const list = JSON.parse(fs.readFileSync(sp, 'utf8'));
list.push({ label: 'registry-watch', kind: 'background-watcher', pid: child.pid, startedAt: new Date().toISOString(), script: 'poc/scripts/registry-watch.js', stopFile: 'poc/results/registry-watch.stop' });
fs.writeFileSync(sp, JSON.stringify(list, null, 2));
console.log('watcher pid', child.pid);
