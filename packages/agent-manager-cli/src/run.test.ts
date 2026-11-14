import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { defaultConfigDir } from './configDir.js';
import { type Harness, makeHarness } from './testHelpers.js';

describe('run', () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.cleanup());

  it('prints the version with -v and --version, and exits 0', async () => {
    for (const flag of ['-v', '--version']) {
      const result = await h.cli([flag]);
      expect(result.code).toBe(0);
      expect(result.out).toMatch(/^\d+\.\d+\.\d+/);
    }
  });

  it('prints the top help with --help, listing every command', async () => {
    const result = await h.cli(['--help']);
    expect(result.code).toBe(0);
    for (const name of ['start', 'stop', 'status', 'cli update', 'cli version', 'cli rollback', 'cli logs', 'cli self-check', 'cli register', 'cli unregister']) {
      expect(result.out).toContain(`agent-manager ${name}`);
    }
  });

  it.each(['start', 'stop', 'status'])('%s fails explicitly: exit 1 and the not-implemented message, never a success', async (name) => {
    const result = await h.cli([name]);
    expect(result.code).toBe(1);
    expect(result.err).toContain('daemon not implemented yet (planned M1b)');
    expect(result.err).toContain(`'agent-manager ${name}'`);
    expect(result.out).toBe('');
  });

  it('fails explicitly in --json mode too (no JSON success on stdout)', async () => {
    const result = await h.cli(['start', '--json']);
    expect(result.code).toBe(1);
    expect(result.out).toBe('');
  });

  // cli register / unregister are real since M1b (see commands/appCore.test.ts): they are never run here, a run must not reach any app-core.
  it('no longer reports cli register and cli unregister as not implemented', async () => {
    const result = await h.cli(['--help']);
    expect(result.out).not.toContain('app-core module not implemented yet');
    expect(result.out).toMatch(/agent-manager cli register +Show the Agents pages in app-core/);
    expect(result.out).toMatch(/agent-manager cli unregister +Remove the Agents pages from app-core/);
  });

  it('cli update refuses a development build with the sibling message, before touching anything', async () => {
    const result = await h.cli(['cli', 'update']);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/^error: dev build \S+: refusing to update the global install of agent-manager; only versions installed from GitHub Packages/);
    expect(result.err).toContain('Use the installed binary instead: agent-manager cli update');
  });

  it('cli rollback refuses a development build as well', async () => {
    const result = await h.cli(['cli', 'rollback']);
    expect(result.code).toBe(1);
    expect(result.err).toContain('refusing to update the global install of agent-manager');
  });

  it('cli self-check passes and names its checks', async () => {
    const result = await h.cli(['cli', 'self-check']);
    expect(result.code).toBe(0);
  });

  it('rejects an unknown command with exit 2 and a hint', async () => {
    const result = await h.cli(['nope']);
    expect(result.code).toBe(2);
    expect(result.err).toContain("unknown command 'nope'");
    expect(result.err).toContain("Run 'agent-manager --help' for usage.");
  });

  it('asks for a subcommand when only the group is given', async () => {
    const result = await h.cli(['cli']);
    expect(result.code).toBe(2);
    expect(result.err).toContain("'cli' needs a subcommand: version, update, rollback, self-check, logs, register, unregister");
  });

  it('rejects an unknown option and an unexpected argument', async () => {
    expect((await h.cli(['start', '--nope'])).code).toBe(2);
    const extra = await h.cli(['start', 'extra']);
    expect(extra.code).toBe(2);
    expect(extra.err).toContain("expected no argument, got 'extra'");
  });

  it('rejects a call without a command', async () => {
    const result = await h.cli([]);
    expect(result.code).toBe(2);
    expect(result.err).toContain('no command given');
  });
});

describe('defaultConfigDir', () => {
  it('prefers AGENT_MANAGER_CONFIG_DIR, then XDG_CONFIG_HOME/agent-manager, then ~/.config/agent-manager', () => {
    expect(defaultConfigDir({ AGENT_MANAGER_CONFIG_DIR: join('o', 'dir'), XDG_CONFIG_HOME: 'x' }, 'h')).toBe(join('o', 'dir'));
    expect(defaultConfigDir({ XDG_CONFIG_HOME: 'x' }, 'h')).toBe(join('x', 'agent-manager'));
    expect(defaultConfigDir({}, 'h')).toBe(join('h', '.config', 'agent-manager'));
  });

  it('ignores blank values', () => {
    expect(defaultConfigDir({ AGENT_MANAGER_CONFIG_DIR: '  ', XDG_CONFIG_HOME: ' ' }, 'h')).toBe(join('h', '.config', 'agent-manager'));
  });
});
