import { dirname } from 'node:path';
import { addLaunchRoot } from '@wadeck-app/agent-manager-core/folders';
import { describe, expect, it } from 'vitest';
import type { DaemonApi } from './daemon/daemonApi.js';
import { useSandbox } from './apiFixtures.js';
import { ioStats } from './guardrailsFiles.js';
import { grantEntry, journalLine, putGrants, putJournal, useHome } from './guardrailsFixtures.js';
import { makeModule } from './testKit.js';

// Temp folders only (the launch roots go to the isolated config folder).
const box = useSandbox();
const home = useHome();

describe('what drops the cached folder list before its time limit', () => {
  it('a launch-roots change (config.yml) and a new daemon session', async () => {
    const stranger = home.project('stranger');
    const fromDaemon = home.project('from-daemon');
    putGrants(stranger, { overrides: [grantEntry({ id: 'stranger-grant' })] });
    putGrants(fromDaemon, { overrides: [grantEntry({ id: 'daemon-grant' })] });
    putJournal(home.journalDir, '2026-11-21', [journalLine({ project: stranger })]);
    const views: { id: string; cwd: string }[] = [];
    const daemon = { list: async () => views } as unknown as DaemonApi;
    const m = makeModule({ dataDir: box.data, options: { daemon, guardrails: { homeDir: home.home } } });
    const ids = async (): Promise<string[]> => ((await m.call('GET', '/guardrails/overview')).body.grants as { id: string }[]).map((g) => g.id).sort();
    expect(await ids()).toEqual([]);
    const base = ioStats.discoveries;
    // A launch root that holds the journal folder: nothing else changed, and the time limit is far.
    await addLaunchRoot(process.env['AGENT_MANAGER_CONFIG_DIR']!, dirname(stranger));
    expect(await ids()).toEqual(['stranger-grant']);
    expect(ioStats.discoveries).toBe(base + 1);
    // A session the daemon just started.
    views.push({ id: 'b0b0b0b0-0000-4000-8000-000000000001', cwd: fromDaemon });
    expect(await ids()).toEqual(['daemon-grant', 'stranger-grant']);
    expect(ioStats.discoveries).toBe(base + 2);
    // Nothing changed: served from the cache.
    expect(await ids()).toEqual(['daemon-grant', 'stranger-grant']);
    expect(ioStats.discoveries).toBe(base + 2);
  });
});
