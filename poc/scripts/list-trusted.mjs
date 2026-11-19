// Lists project paths in ~/.claude.json that contain a given substring and their hasTrustDialogAccepted flag (read-only).
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const [needle = ''] = process.argv.slice(2);
const j = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'));
for (const [p, v] of Object.entries(j.projects ?? {})) if (p.toLowerCase().includes(needle.toLowerCase())) console.log(p, v.hasTrustDialogAccepted);
