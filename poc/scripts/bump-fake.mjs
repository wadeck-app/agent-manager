// Makes two idle fake sessions "Done" (status changed after the baseline seen marker). Usage: node bump-fake.mjs <sessionsDir>
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
for (const file of fs.readdirSync(dir)) {
  const full = path.join(dir, file);
  const body = JSON.parse(fs.readFileSync(full, 'utf8'));
  if (body.name === 'project-owner' || body.name === 'docs-writer') {
    body.statusUpdatedAt = Date.now() - 30_000;
    body.updatedAt = body.statusUpdatedAt;
    fs.writeFileSync(full, JSON.stringify(body));
    console.log('bumped', file);
  }
}
