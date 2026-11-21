import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as realFs from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { removeDir } from '../testFixtures.js';
import { ReplyError } from './errors.js';
import type { ReplyFs } from './fsTypes.js';
import { DEFAULT_REPLY_MARKER, REPLY_MARKER_MODES, parseReplyMarker, readReplyMarker, setReplyMarker } from './replyMarker.js';

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-manager-marker-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    removeDir(dir);
  }
});

describe('parseReplyMarker', () => {
  it('accepts the three modes, the default is none', () => {
    expect(REPLY_MARKER_MODES).toEqual(['none', 'short', 'full']);
    expect(DEFAULT_REPLY_MARKER).toBe('none');
    for (const mode of REPLY_MARKER_MODES) {
      expect(parseReplyMarker(mode, 'x')).toBe(mode);
    }
  });
  it.each(['loud', '', 'None', 'FULL', 3, null, undefined])('refuses %j with the accepted values, the place and a fix', (value) => {
    const error = (() => {
      try {
        parseReplyMarker(value, 'some/config.yml line 3');
      } catch (caught) {
        return caught;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(ReplyError);
    expect((error as ReplyError).code).toBe('invalid-config');
    expect((error as ReplyError).reason).toMatch(/some\/config\.yml line 3: replyMarker must be one of none, short, full/);
    expect((error as ReplyError).fix).toMatch(/reply-marker set/);
  });
});

describe('readReplyMarker', () => {
  const write = (dir: string, text: string): void => writeFileSync(join(dir, 'config.yml'), text);

  it('defaults to none when the file or the key is missing, and says so', async () => {
    const dir = tempDir();
    expect(await readReplyMarker(dir)).toEqual({ mode: 'none', source: 'default', file: join(dir, 'config.yml') });
    write(dir, 'autoUpdate: false\n');
    expect(await readReplyMarker(dir)).toMatchObject({ mode: 'none', source: 'default' });
  });
  it.each([
    ['replyMarker: short\n', 'short'],
    ['autoUpdate: false\nreplyMarker: full\nhintAfter: 5s\n', 'full'],
    ['replyMarker: "short"\n', 'short'],
    ["replyMarker: 'full'   # comment\n", 'full'],
    ['replyMarker:none\r\nautoUpdate: false\r\n', 'none'],
    ['replyMarker : full', 'full'],
  ])('reads %j', async (text, mode) => {
    const dir = tempDir();
    write(dir, text);
    expect(await readReplyMarker(dir)).toMatchObject({ mode, source: 'config.yml' });
  });
  it('ignores a commented replyMarker', async () => {
    const dir = tempDir();
    write(dir, '# replyMarker: short\n');
    expect(await readReplyMarker(dir)).toMatchObject({ mode: 'none', source: 'default' });
  });
  it('an indented or nested replyMarker is an explicit error (file, line, fix), never ignored or defaulted', async () => {
    const dir = tempDir();
    write(dir, 'other:\n  replyMarker: full\n');
    await expect(readReplyMarker(dir)).rejects.toThrow(/config\.yml line 2: replyMarker is indented \(nested under another key\?\)/);
    await expect(readReplyMarker(dir)).rejects.toMatchObject({ code: 'invalid-config', fix: expect.stringContaining('at the start of the line') });
    write(dir, '\treplyMarker: none\n');
    await expect(readReplyMarker(dir)).rejects.toThrow(/line 1: replyMarker is indented/);
    await expect(setReplyMarker(dir, 'full')).rejects.toThrow(/line 1: replyMarker is indented/);
    expect(readFileSync(join(dir, 'config.yml'), 'utf8')).toBe('\treplyMarker: none\n');
  });
  it('reads a file that starts with a UTF-8 BOM (the first line included)', async () => {
    const dir = tempDir();
    write(dir, '\uFEFFreplyMarker: full\nautoUpdate: false\n');
    expect(await readReplyMarker(dir)).toMatchObject({ mode: 'full', source: 'config.yml' });
  });
  it('an unknown or empty value is an error naming the file, the line and the accepted values (never defaulted)', async () => {
    const dir = tempDir();
    write(dir, 'autoUpdate: false\nreplyMarker: loud\n');
    await expect(readReplyMarker(dir)).rejects.toThrow(new RegExp(`${join(dir, 'config.yml').replace(/[\\.]/g, '\\$&')} line 2: replyMarker must be one of none, short, full, got "loud"`));
    write(dir, 'replyMarker:\n');
    await expect(readReplyMarker(dir)).rejects.toThrow(/got ""/);
  });
  it('a repeated key is an error with the lines', async () => {
    const dir = tempDir();
    write(dir, 'replyMarker: none\nreplyMarker: full\n');
    await expect(readReplyMarker(dir)).rejects.toThrow(/set 2 times \(lines 1, 2\)/);
  });
  it('an unreadable file is an error, not the default', async () => {
    const dir = tempDir();
    // A folder named config.yml: reading it fails with something other than ENOENT.
    mkdirSync(join(dir, 'config.yml'));
    await expect(readReplyMarker(dir)).rejects.toMatchObject({ code: 'config-unreadable' });
  });
});

describe('setReplyMarker', () => {
  it('keeps the BOM, on a replaced line and on an appended one', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'config.yml'), '\uFEFFreplyMarker: full\nb: 1\n');
    await setReplyMarker(dir, 'none');
    expect(readFileSync(join(dir, 'config.yml'), 'utf8')).toBe('\uFEFFreplyMarker: none\nb: 1\n');
    writeFileSync(join(dir, 'config.yml'), '\uFEFFb: 1\n');
    await setReplyMarker(dir, 'short');
    expect(readFileSync(join(dir, 'config.yml'), 'utf8')).toBe('\uFEFFb: 1\nreplyMarker: short\n');
  });
  it('a CRLF file without a final line ending: one ending style, the other lines untouched', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'config.yml'), 'a: 1\r\nb: 2');
    await setReplyMarker(dir, 'full');
    expect(readFileSync(join(dir, 'config.yml'), 'utf8')).toBe('a: 1\r\nb: 2\r\nreplyMarker: full\r\n');
  });
  it('a file that already mixes endings keeps every existing line byte for byte', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'config.yml'), 'a: 1\r\nb: 2\nc: 3\r\n');
    await setReplyMarker(dir, 'none');
    expect(readFileSync(join(dir, 'config.yml'), 'utf8')).toBe('a: 1\r\nb: 2\nc: 3\r\nreplyMarker: none\r\n');
  });
  it('retries a rename refused for a moment (EPERM on Windows) and then succeeds', async () => {
    const dir = tempDir();
    let refusals = 2;
    const fs = {
      ...realFs,
      rename: (from: string, to: string) => {
        if (refusals-- > 0) {
          return Promise.reject(Object.assign(new Error('operation not permitted'), { code: 'EPERM' }));
        }
        return realFs.rename(from, to);
      },
    } as ReplyFs;
    await setReplyMarker(dir, 'short', fs);
    expect(readFileSync(join(dir, 'config.yml'), 'utf8')).toBe('replyMarker: short\n');
    expect(refusals).toBe(-1);
  });
  it('a rename that keeps failing is a clear error with the file and the fix, and leaves no temp file', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'config.yml'), 'a: 1\n');
    const fs = { ...realFs, rename: () => Promise.reject(Object.assign(new Error('busy'), { code: 'EBUSY' })) } as ReplyFs;
    await expect(setReplyMarker(dir, 'short', fs)).rejects.toMatchObject({ code: 'config-not-written', reason: expect.stringContaining(join(dir, 'config.yml')), fix: expect.stringContaining('close what holds config.yml open') });
    expect(readFileSync(join(dir, 'config.yml'), 'utf8')).toBe('a: 1\n');
    expect(readdirSync(dir)).toEqual(['config.yml']);
  });
  it('another error code is not retried', async () => {
    const dir = tempDir();
    let calls = 0;
    const fs = { ...realFs, rename: () => { calls++; return Promise.reject(Object.assign(new Error('no space'), { code: 'ENOSPC' })); } } as ReplyFs;
    await expect(setReplyMarker(dir, 'short', fs)).rejects.toMatchObject({ code: 'config-not-written' });
    expect(calls).toBe(1);
  });
  it('creates config.yml when missing', async () => {
    const dir = tempDir();
    expect(await setReplyMarker(dir, 'short')).toMatchObject({ mode: 'short', source: 'config.yml' });
    expect(readFileSync(join(dir, 'config.yml'), 'utf8')).toBe('replyMarker: short\n');
  });
  it('appends to a file without the key and keeps every other line', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'config.yml'), '# my settings\nautoUpdate: false\n');
    await setReplyMarker(dir, 'full');
    expect(readFileSync(join(dir, 'config.yml'), 'utf8')).toBe('# my settings\nautoUpdate: false\nreplyMarker: full\n');
  });
  it('appends after a last line without a newline', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'config.yml'), 'autoUpdate: false');
    await setReplyMarker(dir, 'none');
    expect(readFileSync(join(dir, 'config.yml'), 'utf8')).toBe('autoUpdate: false\nreplyMarker: none\n');
  });
  it('replaces the line in place, keeps the others and the CRLF line endings', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'config.yml'), 'a: 1\r\nreplyMarker: short # old\r\nb: 2\r\n');
    await setReplyMarker(dir, 'none');
    expect(readFileSync(join(dir, 'config.yml'), 'utf8')).toBe('a: 1\r\nreplyMarker: none\r\nb: 2\r\n');
    expect((await readReplyMarker(dir)).mode).toBe('none');
  });
  it('appends with CRLF in a CRLF file', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'config.yml'), 'a: 1\r\n');
    await setReplyMarker(dir, 'full');
    expect(readFileSync(join(dir, 'config.yml'), 'utf8')).toBe('a: 1\r\nreplyMarker: full\r\n');
  });
  it('refuses an unknown mode without touching the file', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'config.yml'), 'a: 1\n');
    await expect(setReplyMarker(dir, 'loud')).rejects.toThrow(/must be one of none, short, full/);
    expect(readFileSync(join(dir, 'config.yml'), 'utf8')).toBe('a: 1\n');
  });
  it('refuses a repeated key without touching the file, and leaves no temp file', async () => {
    const dir = tempDir();
    const text = 'replyMarker: none\nreplyMarker: full\n';
    writeFileSync(join(dir, 'config.yml'), text);
    await expect(setReplyMarker(dir, 'short')).rejects.toThrow(/set 2 times/);
    expect(readFileSync(join(dir, 'config.yml'), 'utf8')).toBe(text);
    expect(readdirSync(dir)).toEqual(['config.yml']);
  });
  it('leaves no temp file after a write', async () => {
    const dir = tempDir();
    await setReplyMarker(dir, 'full');
    expect(readdirSync(dir)).toEqual(['config.yml']);
  });
});
