'use strict';
// usage: node show.js <results file> <dot.path> : prints a JSON sub-tree
const fs = require('fs');
const path = require('path');
let o = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'results', process.argv[2]), 'utf8'));
for (const k of (process.argv[3] || '').split('.').filter(Boolean)) o = o[k];
console.log(JSON.stringify(o, null, 1));
