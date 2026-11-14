import { describe, expect, it, vi } from 'vitest';
import { type UpdaterDeps, runAgentManagerUpdater } from './runAgentManagerUpdater.js';

function deps(version: string): { deps: UpdaterDeps; stderr: string[]; runUpdater: ReturnType<typeof vi.fn> } {
  const stderr: string[] = [];
  const runUpdater = vi.fn(async () => undefined);
  return {
    stderr,
    runUpdater,
    deps: {
      env: {},
      configDir: 'cfg',
      version,
      nodePath: 'node',
      npmRootGlobal: () => 'root',
      runUpdater,
      readCache: () => null,
      readState: () => null,
      cacheFile: 'cache.json',
      stateFile: 'state.json',
      writeState: () => undefined,
      now: () => 0,
      stdout: () => undefined,
      stderr: (line) => stderr.push(line),
    },
  };
}

describe('runAgentManagerUpdater', () => {
  it('refuses a development build and never installs anything', async () => {
    const { deps: d, stderr, runUpdater } = deps('0.0.0-local');
    expect(await runAgentManagerUpdater(d)).toBe(1);
    expect(runUpdater).not.toHaveBeenCalled();
    expect(stderr.join('\n')).toContain('refusing to update the global install of agent-manager');
  });

  it('updates a release build against the agent-manager package, with the self-check of the installed bundle', async () => {
    const { deps: d, runUpdater } = deps('2026.11.14-001-abcdef12');
    expect(await runAgentManagerUpdater(d)).toBe(0);
    expect(runUpdater).toHaveBeenCalledWith(expect.objectContaining({ pkgName: '@wadeck-app/agent-manager-cli', currentVersion: '2026.11.14-001-abcdef12' }));
    expect(d.env['UPDATER_SELF_CHECK_CMD']).toContain('agent-manager.cjs');
    expect(d.env['UPDATER_SELF_CHECK_CMD']).toContain('cli self-check');
  });

  it('reports a crash of the install with exit 1', async () => {
    const { deps: d, stderr, runUpdater } = deps('2026.11.14-001-abcdef12');
    runUpdater.mockRejectedValueOnce(new Error('boom'));
    expect(await runAgentManagerUpdater(d)).toBe(1);
    expect(stderr.join('\n')).toContain('fatal: Error: boom');
  });
});
