import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { selfChecks } from './selfChecks.js';
import { removeTempDir } from './testHelpers.js';

let root: string;
let previous: string | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-manager-selfchecks-'));
  previous = process.env['AGENT_MANAGER_CONFIG_DIR'];
  process.env['AGENT_MANAGER_CONFIG_DIR'] = path.join(root, 'config');
});

afterEach(() => {
  if (previous === undefined) {
    delete process.env['AGENT_MANAGER_CONFIG_DIR'];
  } else {
    process.env['AGENT_MANAGER_CONFIG_DIR'] = previous;
  }
  removeTempDir(root);
});

async function results() {
  return Promise.all(selfChecks().map((run) => run()));
}

describe('selfChecks', () => {
  it('all pass on a machine where the app-module was never registered', async () => {
    const all = await results();
    expect(all.map((r) => r.name)).toEqual(['Version', 'Duration parser', 'Staged app-module (when registered)']);
    expect(all.filter((r) => !r.ok)).toEqual([]);
  });

  it('the staged check fails, with the file and the fix, when a registered module has an unreadable manifest', async () => {
    const dir = path.join(root, 'config', 'app-module', '1.0.0');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), 'not json');
    const failed = (await results()).filter((r) => !r.ok);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.name).toBe('Staged app-module (when registered)');
    expect(failed[0]?.detail).toContain(path.join(dir, 'manifest.json'));
    expect(failed[0]?.detail).toContain('agent-manager cli register');
  });

  it('the staged check passes for a registered module with a valid manifest', async () => {
    const dir = path.join(root, 'config', 'app-module', '1.0.0');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ id: 'agent-manager', version: '1.0.0' }));
    expect((await results()).filter((r) => !r.ok)).toEqual([]);
  });
});
