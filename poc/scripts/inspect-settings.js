'use strict';
// Read-only: prints the shape (keys only, no secret values) of the user's settings.
const fs = require('fs');
const os = require('os');
const path = require('path');
const s = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'));
console.log('keys:', Object.keys(s).join(', '));
console.log('env keys:', Object.keys(s.env || {}).join(', '));
console.log('model:', s.model, '| crossSessionInbound:', s.crossSessionInbound, '| defaultMode:', s.permissions && s.permissions.defaultMode);
console.log('hook events:', Object.keys(s.hooks || {}).join(', '));
console.log('enabledPlugins:', Object.keys(s.enabledPlugins || {}).length);
