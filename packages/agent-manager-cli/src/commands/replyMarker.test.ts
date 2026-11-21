import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Harness, makeHarness } from '../testHelpers.js';

describe('agent-manager reply-marker', () => {
  let h: Harness;
  const configFile = (): string => join(h.configDir, 'config.yml');
  const text = (): string => readFileSync(configFile(), 'utf8');

  beforeEach(() => {
    h = makeHarness();
  });
  afterEach(() => h.cleanup());

  describe('show', () => {
    it('says none when config.yml does not set it, and where that comes from', async () => {
      const result = await h.cli(['reply-marker', 'show']);
      expect(result.code).toBe(0);
      expect(result.out).toContain('Reply marker: none (no marker line');
      expect(result.out).toContain('default');
      expect(result.out).toContain('reply-marker set <none|short|full>');
      expect(result.out).toContain('does not depend on the marker');
    });

    it('shows the value of config.yml and gives it in --json with the accepted modes', async () => {
      writeFileSync(configFile(), 'autoUpdate: false\nreplyMarker: short\n');
      const result = await h.cli(['reply-marker', 'show', '--json']);
      expect(result.code).toBe(0);
      expect(JSON.parse(result.out)).toMatchObject({ mode: 'short', source: 'config.yml', file: configFile(), modes: ['none', 'short', 'full'], defaultMode: 'none' });
    });

    it('an unknown value is an error naming the file and the accepted values, never the default', async () => {
      writeFileSync(configFile(), 'replyMarker: loud\n');
      const result = await h.cli(['reply-marker', 'show']);
      expect(result.code).toBe(1);
      expect(result.err).toContain(configFile());
      expect(result.err).toContain('replyMarker must be one of none, short, full');
      expect(result.out).toBe('');
    });

    it('rejects an argument', async () => {
      expect((await h.cli(['reply-marker', 'show', 'full'])).code).toBe(2);
    });
  });

  describe('set', () => {
    it.each(['none', 'short', 'full'])('sets %s and keeps the other keys of config.yml', async (mode) => {
      const before = text();
      const result = await h.cli(['reply-marker', 'set', mode]);
      expect(result.code).toBe(0);
      expect(result.out).toContain(`Reply marker is now ${mode}`);
      expect(text()).toBe(`${before}replyMarker: ${mode}\n`);
      expect(JSON.parse((await h.cli(['reply-marker', 'show', '--json'])).out)).toMatchObject({ mode, source: 'config.yml' });
    });

    it('changes an existing line in place', async () => {
      writeFileSync(configFile(), 'replyMarker: full\nautoUpdate: false\n');
      await h.cli(['reply-marker', 'set', 'none']);
      expect(text()).toBe('replyMarker: none\nautoUpdate: false\n');
    });

    it('--json gives the new mode and the file', async () => {
      const result = await h.cli(['reply-marker', 'set', 'short', '--json']);
      expect(JSON.parse(result.out)).toEqual({ ok: true, mode: 'short', file: configFile() });
    });

    it('an unknown mode is an error with the accepted values and does not touch the file', async () => {
      const before = text();
      const result = await h.cli(['reply-marker', 'set', 'loud']);
      expect(result.code).toBe(1);
      expect(result.err).toContain('replyMarker must be one of none, short, full, got "loud"');
      expect(text()).toBe(before);
    });

    it('a missing mode is a usage error (2)', async () => {
      const result = await h.cli(['reply-marker', 'set']);
      expect(result.code).toBe(2);
    });

    it('does not overwrite a config.yml that repeats the key', async () => {
      const repeated = 'replyMarker: none\nreplyMarker: full\n';
      writeFileSync(configFile(), repeated);
      const result = await h.cli(['reply-marker', 'set', 'short']);
      expect(result.code).toBe(1);
      expect(result.err).toContain('set 2 times');
      expect(text()).toBe(repeated);
    });
  });

  it('is listed in the help', async () => {
    const result = await h.cli(['--help']);
    expect(result.out).toContain('reply-marker show');
    expect(result.out).toContain('reply-marker set');
  });
});
