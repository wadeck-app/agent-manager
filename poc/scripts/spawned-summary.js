'use strict';
const L = require('./lib');
for (const s of L.readSpawned()) console.log(s.label, s.pid, s.startedAt, 'exited', s.exitedAt || '-', s.exitCode);
