'use strict';
// usage: node grep-transcript.js <label> <regex>: counts transcript lines of a PoC session (by label in spawned.json) matching the regex
const fs = require('fs');
const L = require('./lib');
const [label, re] = process.argv.slice(2);
const e = L.readSpawned().filter((s) => s.label === label).pop();
if (!e) { console.error('no such label'); process.exit(1); }
const f = L.findTranscript(e.sessionId);
if (!f) { console.error('no transcript for ' + e.sessionId); process.exit(1); }
const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
console.log(f, 'lines:', lines.length, 'matching', re, ':', lines.filter((l) => new RegExp(re).test(l)).length);
