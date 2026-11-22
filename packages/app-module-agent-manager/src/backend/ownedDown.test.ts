import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { useSandbox } from './apiFixtures.js';
import { createDaemonApi } from './daemon/daemonApi.js';
import { startFakeDaemon } from './daemon/fakeDaemon.js';
import type { FakeDaemon } from './daemon/fakeDaemon.js';
import { makeModule } from './testKit.js';

const box = useSandbox();
const START = 'agent-manager start --detach';

let daemon: FakeDaemon | undefined;
afterEach(async () => {
  await daemon?.stop();
  daemon = undefined;
});

const mod = () => makeModule({ dataDir: box.data, options: { daemon: createDaemonApi({ cacheMs: 0, timeoutMs: 3000 }) } });

function record(id: string): Record<string, unknown> {
  return { id, hostKind: 'stream-json', cwd: '/work/shop', claudeVersion: '2.1.326', startedAt: 1_000_000, status: 'exited' };
}

function writeState(content: unknown): void {
  writeFileSync(join(box.config, 'owned-sessions.json'), typeof content === 'string' ? content : JSON.stringify(content));
}

const TWO = { version: 1, sessions: [record('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), record('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')] };

describe('GET /sessions: owned sessions whose daemon is down', () => {
  it('daemon down and the state file lists 2 sessions: ownedDown says how many and the fix, with a text that names the lost actions', async () => {
    writeState(TWO);
    const { body } = await mod().call('GET', '/sessions');
    expect(body.ownedDown).toEqual({ count: 2, fix: START });
    expect(body.ownedDownText).toContain('2 owned sessions');
    expect(body.ownedDownText).toContain('Stop, Resume and Move');
    expect(body.ownedDownText).toContain(START);
    expect(body.ownedStateErrorText).toBe('');
  });

  it('singular for one session', async () => {
    writeState({ version: 1, sessions: [record('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')] });
    const { body } = await mod().call('GET', '/sessions');
    expect(body.ownedDown.count).toBe(1);
    expect(body.ownedDownText).toContain('1 owned session ');
  });

  it('daemon down and no state file: nothing (the user never used the daemon)', async () => {
    const { body } = await mod().call('GET', '/sessions');
    expect(body.ownedError).toMatchObject({ code: 'daemon-not-running' });
    expect(body.ownedDown).toBeNull();
    expect(body.ownedDownText).toBe('');
    expect(body.ownedStateErrorText).toBe('');
  });

  it('daemon down and a state file with 0 records: nothing', async () => {
    writeState({ version: 1, sessions: [] });
    const { body } = await mod().call('GET', '/sessions');
    expect(body.ownedDown).toBeNull();
    expect(body.ownedDownText).toBe('');
  });

  it('daemon up and 2 records in the file: nothing', async () => {
    daemon = await startFakeDaemon(box.config);
    writeState(TWO);
    const { body } = await mod().call('GET', '/sessions');
    expect(body.ownedError).toBeNull();
    expect(body.ownedDown).toBeNull();
    expect(body.ownedDownText).toBe('');
  });

  it('daemon down and a corrupt state file: its own visible message with the path and the fix, never silence; the sessions stay listed', async () => {
    writeState('{ not json');
    const { status, body } = await mod().call('GET', '/sessions');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.ownedDown).toBeNull();
    expect(body.ownedStateErrorText).toContain('owned-sessions.json');
    expect(body.ownedStateErrorText).toContain('not valid JSON');
    expect(body.ownedStateErrorText).toContain('.bad');
    // The fix is said once: LaunchError.message already ends with 'Fix: ...', it is not appended a second time (the sentence was shown twice).
    expect(body.ownedStateErrorText.match(/Fix:/g)).toHaveLength(1);
    expect(body.ownedStateErrorText.match(/move it aside/g)).toHaveLength(1);
  });

  it('daemon down and a file of an unknown version: the version message', async () => {
    writeState({ version: 99, sessions: [record('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')] });
    const { body } = await mod().call('GET', '/sessions');
    expect(body.ownedDown).toBeNull();
    expect(body.ownedStateErrorText).toContain('version 99');
  });

  it('the state file is only read, never written (a corrupt file stays as it was)', async () => {
    writeState('{ not json');
    await mod().call('GET', '/sessions');
    const { readFileSync } = await import('node:fs');
    expect(readFileSync(join(box.config, 'owned-sessions.json'), 'utf8')).toBe('{ not json');
  });
});
