import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReplyTransport } from '@wadeck-app/agent-manager-core/reply';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Harness, makeHarness } from '../testHelpers.js';

// The real hc transport would run the real `hc` to probe: the tests only ever see these two fakes, which send nothing.
const fakes = vi.hoisted(() => {
  const transport = (id: string, deliveredAs: 'peer' | 'typed', available: boolean): ReplyTransport => ({
    id,
    kind: 'direct',
    deliveredAs,
    describe: () => `fake ${id} transport`,
    probe: () => Promise.resolve(available ? { available: true, reason: `${id} works`, fix: '', details: { warnings: id === 'hc' ? ['the terminal reports no status'] : [] } } : { available: false, reason: `${id} is off`, fix: `switch ${id} on`, details: {} }),
    send: () => Promise.reject(new Error('the CLI tests never send')),
  });
  return { transport, state: { hcAvailable: false } };
});
vi.mock('@wadeck-app/agent-manager-core/reply', async (importOriginal) => {
  const original = await importOriginal<typeof import('@wadeck-app/agent-manager-core/reply')>();
  return {
    ...original,
    get implementedTransports() {
      return [fakes.transport('socket', 'peer', true), fakes.transport('hc', 'typed', fakes.state.hcAvailable)];
    },
  };
});

const SESSION = 'aaaaaaaa-1111-4222-8333-444444444444';
const OTHER = 'aaaaaaaa-9999-4222-8333-444444444444';

describe('agent-manager transport', () => {
  let h: Harness;
  let sessionsDir: string;
  const run = (argv: string[]) => h.cli(argv, { env: { AGENT_MANAGER_SESSIONS_DIR: sessionsDir } });
  const transportsFile = (): string => join(h.configDir, 'transports.json');
  const config = (): unknown => JSON.parse(readFileSync(transportsFile(), 'utf8'));

  beforeEach(() => {
    h = makeHarness();
    fakes.state.hcAvailable = false;
    sessionsDir = join(h.configDir, '..', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    for (const [pid, id] of [[process.pid, SESSION], [process.ppid, OTHER]] as const) {
      writeFileSync(join(sessionsDir, `${pid}.json`), JSON.stringify({ pid, sessionId: id, cwd: '/work/shop', status: 'idle', name: 'shop-owner' }));
    }
  });
  afterEach(() => h.cleanup());

  describe('list', () => {
    it('lists the transports, how each delivers and the default, without a session', async () => {
      const result = await run(['transport', 'list']);
      expect(result.code).toBe(0);
      expect(result.out).toContain('Default transport: socket');
      expect(result.out).toContain('* socket  delivered as: peer message (wrapped by Claude Code)');
      expect(result.out).toContain('  hc      delivered as: typed prompt (as the user)');
      expect(result.out).toContain('transport list --session');
    });

    it('with --session shows the availability, the reason, the fix, the warnings and the selected one', async () => {
      await run(['transport', 'set', 'hc', '--session', SESSION]);
      const result = await run(['transport', 'list', '--session', SESSION]);
      expect(result.code).toBe(0);
      expect(result.out).toContain(`selected transport hc (its own setting)`);
      expect(result.out).toMatch(/\* hc {6}NOT available/);
      expect(result.out).toContain('hc is off');
      expect(result.out).toContain('Fix: switch hc on');
      expect(result.out).toMatch(/ {3}socket {2}available/);
    });

    it('--json gives the availability of every transport', async () => {
      fakes.state.hcAvailable = true;
      const result = await run(['transport', 'list', '--session', SESSION.slice(0, 13), '--json']);
      const body = JSON.parse(result.out) as { sessionId: string; transports: { id: string; available: boolean; selected: boolean; deliveredAsText: string; warnings: string[] }[] };
      expect(body.sessionId).toBe(SESSION);
      expect(body.transports.map((entry) => [entry.id, entry.available, entry.selected])).toEqual([['socket', true, true], ['hc', true, false]]);
      expect(body.transports[1]).toMatchObject({ deliveredAsText: 'typed prompt (as the user)', warnings: ['the terminal reports no status'] });
    });

    it('an unknown or ambiguous session is an error that says what to do', async () => {
      const unknown = await run(['transport', 'list', '--session', 'ffffffff-0000']);
      expect(unknown.code).toBe(1);
      expect(unknown.err).toContain("no session 'ffffffff-0000'");
      const ambiguous = await run(['transport', 'list', '--session', 'aaaa']);
      expect(ambiguous.code).toBe(1);
      expect(ambiguous.err).toContain('matches 2 sessions');
    });

    it('a missing registry folder is an error with the fix, not an empty list', async () => {
      const result = await h.cli(['transport', 'list', '--session', SESSION], { env: { AGENT_MANAGER_SESSIONS_DIR: join(h.configDir, 'no-such-folder') } });
      expect(result.code).toBe(1);
      expect(result.err).toContain('no-such-folder');
    });
  });

  describe('set', () => {
    it('sets the default, warns that a typed prompt carries the user authority, and says what it did not change', async () => {
      await run(['transport', 'set', 'socket', '--session', SESSION]);
      const result = await run(['transport', 'set', 'hc']);
      expect(result.code).toBe(0);
      expect(result.out).toContain("The default transport is now 'hc'");
      expect(result.out).toContain('Warning: Replies on this transport are typed into the terminal as the user');
      expect(result.out).toContain(`Not changed, they keep their own transport: ${SESSION} (socket)`);
      expect(config()).toEqual({ default: 'hc', perSession: { [SESSION]: 'socket' } });
    });

    it('sets a session only, resolving a prefix of its id', async () => {
      const result = await run(['transport', 'set', 'hc', '--session', 'aaaaaaaa-1111']);
      expect(result.code).toBe(0);
      expect(config()).toEqual({ default: 'socket', perSession: { [SESSION]: 'hc' } });
    });

    it('an unknown transport id is an error that lists the valid ids, and writes nothing', async () => {
      const result = await run(['transport', 'set', 'pigeon']);
      expect(result.code).toBe(1);
      expect(result.err).toContain('(known: socket, hc)');
      expect(() => readFileSync(transportsFile(), 'utf8')).toThrow();
    });

    it('needs the id', async () => {
      const result = await run(['transport', 'set']);
      expect(result.code).toBe(2);
    });

    it('does not overwrite a transports.json it cannot read', async () => {
      writeFileSync(transportsFile(), '{broken');
      const result = await run(['transport', 'set', 'hc']);
      expect(result.code).toBe(1);
      expect(result.err).toContain('not valid JSON');
      expect(readFileSync(transportsFile(), 'utf8')).toBe('{broken');
    });
  });

  describe('unset', () => {
    it('removes the setting of a session', async () => {
      await run(['transport', 'set', 'hc', '--session', SESSION]);
      const result = await run(['transport', 'unset', '--session', SESSION]);
      expect(result.code).toBe(0);
      expect(result.out).toContain('follows the default transport again (socket)');
      expect(config()).toEqual({ default: 'socket', perSession: {} });
    });

    it('requires --session and points to set for the default', async () => {
      const result = await run(['transport', 'unset']);
      expect(result.code).toBe(2);
      expect(result.err).toContain('transport set <id>');
    });

    it('removes a stale setting of a session that is no longer in the registry', async () => {
      const ended = 'bbbbbbbb-1111-4222-8333-444444444444';
      writeFileSync(transportsFile(), JSON.stringify({ default: 'socket', perSession: { [ended]: 'hc' } }));
      const result = await run(['transport', 'unset', '--session', ended]);
      expect(result.code).toBe(0);
      expect(config()).toEqual({ default: 'socket', perSession: {} });
    });

    it('a session that is neither in the registry nor in transports.json is an error', async () => {
      const result = await run(['transport', 'unset', '--session', 'cccccccc-1111-4222-8333-444444444444']);
      expect(result.code).toBe(1);
      expect(result.err).toContain('transports.json has no setting');
    });
  });
});
