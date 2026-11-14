'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const s = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8'));
console.log(JSON.stringify(s.enabledPlugins, null, 1));
console.log(JSON.stringify(s.hooks, null, 1).slice(0, 2500));
console.log('effort', s.effortLevel, 'modelSettings', JSON.stringify(s.modelSettings));
