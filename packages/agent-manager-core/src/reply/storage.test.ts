import { afterEach, describe, expect, it } from 'vitest';
import { getErrorMessage } from '../errors.js';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeDir } from '../testFixtures.js';
import { appendAudit, findSentInAudit, readAudit } from './audit.js';
import type { AuditRecord } from './audit.js';
import { MAX_TEXT_CHARS, composeMessageText } from './compose.js';
import { purge } from './retention.js';
import { fakePng } from './testSupport.js';
import { MAX_UPLOAD_BYTES, saveUpload } from './uploads.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    removeDir(dir);
  }
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-manager-storage-'));
  dirs.push(dir);
  return dir;
}

describe('composeMessageText', () => {
  it('full: puts the marker first, then the text, then one line per image', () => {
    const text = composeMessageText({ text: 'fix it', imagePaths: ['/tmp/a.png', '/tmp/b.png'], id: 'm1', marker: 'full' });
    expect(text.split('\n')).toEqual([
      '[web reply via agent-manager #m1]',
      'fix it',
      'The user attached an image: /tmp/a.png. Read it.',
      'The user attached an image: /tmp/b.png. Read it.',
    ]);
  });
  it('refuses a text over the cap, an empty reply, a relative image path and an unsafe id', () => {
    expect(() => composeMessageText({ text: 'x'.repeat(MAX_TEXT_CHARS + 1), imagePaths: [], id: 'm1' })).toThrow(/20000/);
    expect(composeMessageText({ text: 'x'.repeat(MAX_TEXT_CHARS), imagePaths: [], id: 'm1' })).toContain('x');
    expect(() => composeMessageText({ text: '  ', imagePaths: [], id: 'm1' })).toThrow(/no text and no image/);
    expect(() => composeMessageText({ text: 'a', imagePaths: ['rel/a.png'], id: 'm1' })).toThrow(/absolute/);
    expect(() => composeMessageText({ text: 'a', imagePaths: [], id: 'a b' })).toThrow(/identifier/);
  });
  it('none: no marker line at all, the text exactly as typed (plus the image lines)', () => {
    expect(composeMessageText({ text: 'fix it', imagePaths: ['/tmp/a.png'], id: 'm1', marker: 'none' }).split('\n')).toEqual(['fix it', 'The user attached an image: /tmp/a.png. Read it.']);
    expect(composeMessageText({ text: 'fix it', imagePaths: [], id: 'm1', marker: 'none' })).toBe('fix it');
    expect(composeMessageText({ text: '  two\n  lines ', imagePaths: [], id: 'm1', marker: 'none' })).toBe('  two\n  lines ');
  });
  it('the default marker is none (D-2026-11-19-a)', () => {
    expect(composeMessageText({ text: 'fix it', imagePaths: [], id: 'm1' })).toBe('fix it');
  });
  it('short: a compact one-line tag with the message id', () => {
    expect(composeMessageText({ text: 'fix it', imagePaths: [], id: 'm1', marker: 'short' })).toBe('[agent-manager-web #m1]\nfix it');
  });
  it('an unknown marker mode is refused with the accepted values', () => {
    expect(() => composeMessageText({ text: 'a', imagePaths: [], id: 'm1', marker: 'loud' as never })).toThrow(/replyMarker must be one of none, short, full, got "loud"/);
  });
  it('accepts an image-only reply', () => {
    expect(composeMessageText({ text: '', imagePaths: ['/tmp/a.png'], id: 'm1' })).toBe('The user attached an image: /tmp/a.png. Read it.');
    expect(composeMessageText({ text: '', imagePaths: ['/tmp/a.png'], id: 'm1', marker: 'full' })).toBe('[web reply via agent-manager #m1]\nThe user attached an image: /tmp/a.png. Read it.');
  });
});

describe('saveUpload', () => {
  const base = { sessionId: '11111111-2222-4333-8444-555555555555', msgId: 'msg-1', index: 0 };

  it('saves a valid png atomically at the fixed path and returns the absolute path and size', async () => {
    const configDir = tempDir();
    const png = fakePng(100);
    const saved = await saveUpload({ configDir, ...base, base64: png.toString('base64'), declaredMime: 'image/png' });
    expect(saved.path).toBe(join(configDir, 'uploads', base.sessionId, 'msg-1-0.png'));
    expect(saved.size).toBe(100);
    expect(readFileSync(saved.path).equals(png)).toBe(true);
    expect(readdirSync(join(configDir, 'uploads', base.sessionId))).toEqual(['msg-1-0.png']);
  });

  it.each([
    ['../escape', 'msg-1'],
    ['a/b', 'msg-1'],
    ['..', 'msg-1'],
    ['a\\b', 'msg-1'],
    [base.sessionId, '../../evil'],
    [base.sessionId, 'x/../y'],
    [base.sessionId, 'a.b'],
    [base.sessionId, ''],
  ])('refuses the identifiers %j / %j (traversal)', async (sessionId, msgId) => {
    const configDir = tempDir();
    await expect(saveUpload({ configDir, sessionId, msgId, index: 0, base64: fakePng().toString('base64') })).rejects.toThrow(/identifier/);
    expect(existsSync(join(configDir, 'uploads'))).toBe(false);
  });

  it('refuses a bad index', async () => {
    await expect(saveUpload({ configDir: tempDir(), ...base, index: -1, base64: fakePng().toString('base64') })).rejects.toThrow(/index/);
    await expect(saveUpload({ configDir: tempDir(), ...base, index: 1.5, base64: fakePng().toString('base64') })).rejects.toThrow(/index/);
  });

  it('refuses content that is not png, jpeg, gif or webp, whatever it declares', async () => {
    const configDir = tempDir();
    const text = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>').toString('base64');
    await expect(saveUpload({ configDir, ...base, base64: text, declaredMime: 'image/png' })).rejects.toThrow(/not a png, jpeg, gif or webp/);
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(50)]).toString('base64');
    await expect(saveUpload({ configDir, ...base, base64: exe })).rejects.toThrow(/not a png/);
    expect(existsSync(join(configDir, 'uploads'))).toBe(false);
  });

  it('refuses a declared type that does not match the content', async () => {
    await expect(saveUpload({ configDir: tempDir(), ...base, base64: fakePng().toString('base64'), declaredMime: 'image/jpeg' })).rejects.toThrow(/does not match/);
  });

  it('accepts jpeg, gif and webp by magic bytes', async () => {
    const configDir = tempDir();
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
    const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(20)]);
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(20)]);
    expect((await saveUpload({ configDir, ...base, index: 0, base64: jpeg.toString('base64'), declaredMime: 'image/jpeg' })).path).toMatch(/-0\.jpg$/);
    expect((await saveUpload({ configDir, ...base, index: 1, base64: gif.toString('base64') })).path).toMatch(/-1\.gif$/);
    expect((await saveUpload({ configDir, ...base, index: 2, base64: webp.toString('base64') })).path).toMatch(/-2\.webp$/);
  });

  it('refuses an image over the cap with a message that states the cap and says to downscale', async () => {
    const configDir = tempDir();
    const big = Buffer.concat([fakePng(), Buffer.alloc(MAX_UPLOAD_BYTES)]);
    const error = (await saveUpload({ configDir, ...base, base64: big.toString('base64') }).catch((e: unknown) => e)) as Error;
    expect(getErrorMessage(error)).toMatch(/700 KB|716800/);
    expect(getErrorMessage(error)).toMatch(/downscale/);
    // exactly at the cap is accepted
    const exact = Buffer.concat([fakePng(), Buffer.alloc(MAX_UPLOAD_BYTES - 64)]);
    expect((await saveUpload({ configDir, ...base, base64: exact.toString('base64') })).size).toBe(MAX_UPLOAD_BYTES);
  });

  it('refuses data that is not plain base64', async () => {
    await expect(saveUpload({ configDir: tempDir(), ...base, base64: `data:image/png;base64,${fakePng().toString('base64')}` })).rejects.toThrow(/plain base64/);
    await expect(saveUpload({ configDir: tempDir(), ...base, base64: 'abc' })).rejects.toThrow(/plain base64/);
    await expect(saveUpload({ configDir: tempDir(), ...base, base64: '' })).rejects.toThrow(/empty/);
  });
});

describe('audit', () => {
  const record = (time: number, msgId: string, outcome = 'sent'): AuditRecord => ({ sessionId: 's1', time, text: `text ${msgId}`, imagePaths: [], transport: 'socket', priority: 'next', outcome, msgId });

  it('appends one line per record to the file of the UTC day and reads them newest first', async () => {
    const configDir = tempDir();
    const day1 = Date.UTC(2026, 10, 14, 23, 59);
    const day2 = Date.UTC(2026, 10, 15, 0, 1);
    await appendAudit(configDir, record(day1, 'a'));
    await appendAudit(configDir, record(day1 + 1000, 'b'));
    await appendAudit(configDir, record(day2, 'c'));
    expect(readdirSync(join(configDir, 'audit')).sort()).toEqual(['2026-11-14.ndjson', '2026-11-15.ndjson']);
    expect(readFileSync(join(configDir, 'audit', '2026-11-14.ndjson'), 'utf8').trim().split('\n')).toHaveLength(2);
    const all = await readAudit(configDir);
    expect(all.records.map((r) => r.msgId)).toEqual(['c', 'b', 'a']);
    expect((await readAudit(configDir, { limit: 2 })).records.map((r) => r.msgId)).toEqual(['c', 'b']);
    expect((await readAudit(configDir, { sinceMs: day1 + 500 })).records.map((r) => r.msgId)).toEqual(['c', 'b']);
  });

  it('sessionId filters before the limit: other sessions never crowd this one out', async () => {
    const configDir = tempDir();
    const base = Date.UTC(2026, 10, 15, 10);
    await appendAudit(configDir, { ...record(base, 'mine-1'), sessionId: 'mine' });
    await appendAudit(configDir, { ...record(base + 1, 'mine-2'), sessionId: 'mine' });
    for (let i = 0; i < 5; i++) {
      await appendAudit(configDir, { ...record(base + 100 + i, `other-${i}`), sessionId: 'other' });
    }
    expect((await readAudit(configDir, { limit: 3 })).records.some((r) => r.sessionId === 'mine')).toBe(false);
    expect((await readAudit(configDir, { limit: 3, sessionId: 'mine' })).records.map((r) => r.msgId)).toEqual(['mine-2', 'mine-1']);
  });

  it('reads an empty list when nothing was recorded, and reports a damaged line instead of dropping it', async () => {
    const configDir = tempDir();
    expect(await readAudit(configDir)).toEqual({ records: [], unreadable: [] });
    await appendAudit(configDir, record(Date.UTC(2026, 10, 14), 'a'));
    writeFileSync(join(configDir, 'audit', '2026-11-14.ndjson'), `${JSON.stringify(record(Date.UTC(2026, 10, 14), 'a'))}\n{"broken\n`);
    const result = await readAudit(configDir);
    expect(result.records).toHaveLength(1);
    expect(result.unreadable).toEqual([{ file: '2026-11-14.ndjson', line: 2, reason: expect.stringContaining('not valid JSON') }]);
  });

  it('finds a sent record by message id and ignores failed ones', async () => {
    const configDir = tempDir();
    await appendAudit(configDir, record(Date.UTC(2026, 10, 14), 'a', 'failed: pipe refused'));
    await appendAudit(configDir, record(Date.UTC(2026, 10, 15), 'b'));
    expect(await findSentInAudit(configDir, 'a')).toBeUndefined();
    expect((await findSentInAudit(configDir, 'b'))?.msgId).toBe('b');
    expect(await findSentInAudit(tempDir(), 'b')).toBeUndefined();
  });
});

describe('purge', () => {
  const NOW = Date.UTC(2026, 10, 15);
  const DAY = 86_400_000;

  function file(path: string, bytes: number, ageDays: number): void {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, Buffer.alloc(bytes, 1));
    const time = (NOW - ageDays * DAY) / 1000;
    utimesSync(path, time, time);
  }

  it('deletes by age, per category, and removes the emptied session folders', async () => {
    const configDir = tempDir();
    file(join(configDir, 'uploads', 's1', 'old.png'), 10, 100);
    file(join(configDir, 'uploads', 's1', 'new.png'), 10, 1);
    file(join(configDir, 'uploads', 's2', 'old.png'), 10, 91);
    file(join(configDir, 'audit', '2026-01-01.ndjson'), 5, 200);
    file(join(configDir, 'history', 'h.ndjson'), 5, 1);
    const result = await purge({ configDir, now: NOW });
    expect(result.uploads).toMatchObject({ deleted: 2, bytesFreed: 20, kept: 1, bytesKept: 10, failures: [] });
    expect(result.audit).toMatchObject({ deleted: 1, kept: 0 });
    expect(result.history).toMatchObject({ deleted: 0, kept: 1 });
    expect(existsSync(join(configDir, 'uploads', 's2'))).toBe(false);
    expect(existsSync(join(configDir, 'uploads', 's1', 'new.png'))).toBe(true);
  });

  it('deletes the oldest files first when a category is over the size cap', async () => {
    const configDir = tempDir();
    file(join(configDir, 'uploads', 's', 'c.png'), 40, 1);
    file(join(configDir, 'uploads', 's', 'a.png'), 40, 30);
    file(join(configDir, 'uploads', 's', 'b.png'), 40, 10);
    const result = await purge({ configDir, now: NOW, maxBytes: 80 });
    expect(result.uploads).toMatchObject({ deleted: 1, bytesFreed: 40, kept: 2 });
    expect(readdirSync(join(configDir, 'uploads', 's')).sort()).toEqual(['b.png', 'c.png']);
    const second = await purge({ configDir, now: NOW, maxBytes: 40 });
    expect(second.uploads.deleted).toBe(1);
    expect(readdirSync(join(configDir, 'uploads', 's'))).toEqual(['c.png']);
  });

  it('treats a missing category as empty', async () => {
    const result = await purge({ configDir: tempDir(), now: NOW });
    expect(result).toEqual({
      uploads: { deleted: 0, bytesFreed: 0, kept: 0, bytesKept: 0, failures: [] },
      audit: { deleted: 0, bytesFreed: 0, kept: 0, bytesKept: 0, failures: [] },
      history: { deleted: 0, bytesFreed: 0, kept: 0, bytesKept: 0, failures: [] },
    });
  });
});
