import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendAudit, composeMessageText, wireMsgId, type AuditRecord } from '@wadeck-app/agent-manager-core/reply';
import { afterEach, describe, expect, it } from 'vitest';
import type { LogEntry } from '../commons/api.js';
import { linkWebReplies } from './webReplyLinks.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});
const SESSION = 'aaaaaaaa-1111-4222-8333-444444444444';
const NOW = Date.now();

async function configWith(records: Partial<AuditRecord>[]): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'agent-manager-links-'));
  dirs.push(dir);
  for (const record of records) {
    await appendAudit(dir, { sessionId: SESSION, time: NOW, text: 'salut', imagePaths: [], transport: 'socket', priority: 'next', outcome: 'sent', msgId: 'm-abc12345-xyz', ...record });
  }
  return dir;
}
const peer = (key: string, text: string, originMsgId: string | undefined, extra: Record<string, unknown> = {}): LogEntry =>
  ({ key, offset: 0, kind: 'user-prompt', source: 'peer', queued: false, isMeta: true, text: `Another Claude session sent a message:\n${text}\n\nThis came from another Claude session. Reply to it.`, images: [], textTruncated: false, textBytes: 0, timestamp: NOW + 500, ...(originMsgId === undefined ? {} : { originMsgId }), ...extra }) as LogEntry;
const enqueue = (key: string, preview: string, extra: Record<string, unknown> = {}): LogEntry => ({ key, offset: 0, kind: 'queue-operation', operation: 'enqueue', contentPreview: preview, timestamp: NOW + 200, ...extra }) as LogEntry;

describe('linkWebReplies', () => {
  describe('peer messages, by origin.msg_id', () => {
    it('sets webReply on the peer message whose origin.msg_id is the wire id of an audited reply (no marker needed)', async () => {
      const dir = await configWith([{}]);
      const { entries, note } = await linkWebReplies([peer('p', 'salut', wireMsgId('m-abc12345-xyz'))], SESSION, dir);
      expect(note).toBe('');
      expect(entries[0]).toMatchObject({ webReply: { messageId: 'm-abc12345-xyz', text: 'salut' } });
    });
    it('does not touch a peer message of another id, of no id, or already recognized by its marker', async () => {
      const dir = await configWith([{}]);
      const other = peer('o', 'salut', wireMsgId('m-other'));
      const noId = peer('n', 'salut', undefined);
      const marked = peer('k', 'salut', wireMsgId('m-abc12345-xyz'), { webReply: { messageId: 'm-marker', text: 'salut' } });
      const { entries } = await linkWebReplies([other, noId, marked], SESSION, dir);
      expect(entries[0]).toBe(other);
      expect(entries[1]).toBe(noId);
      expect((entries[2] as { webReply: { messageId: string } }).webReply.messageId).toBe('m-marker');
    });
    it('only the replies of this session count', async () => {
      const dir = await configWith([{ sessionId: 'bbbbbbbb-1111-4222-8333-444444444444' }]);
      const { entries } = await linkWebReplies([peer('p', 'salut', wireMsgId('m-abc12345-xyz'))], SESSION, dir);
      expect(entries[0]).not.toHaveProperty('webReply');
    });
    it('a reply that was not sent (failed, refused) is not linked', async () => {
      const dir = await configWith([{ outcome: 'failed: nope' }]);
      const { entries } = await linkWebReplies([peer('p', 'salut', wireMsgId('m-abc12345-xyz'))], SESSION, dir);
      expect(entries[0]).not.toHaveProperty('webReply');
    });
  });

  describe('queue lines, by exact text and time', () => {
    it('marks the enqueue whose preview is exactly the reply, with or without the wrapper, for every marker mode', async () => {
      const dir = await configWith([{}]);
      const texts = (['none', 'short', 'full'] as const).map((marker) => composeMessageText({ text: 'salut', imagePaths: [], id: 'm-abc12345-xyz', marker }));
      const { entries } = await linkWebReplies([...texts.map((text, i) => enqueue(`a${i}`, text)), enqueue('w', `Another Claude session sent a message: ${texts[0]}`)], SESSION, dir);
      expect(entries.map((entry) => (entry as { webReplyId?: string }).webReplyId)).toEqual(['m-abc12345-xyz', 'm-abc12345-xyz', 'm-abc12345-xyz', 'm-abc12345-xyz']);
    });
    it('never marks a person\'s own queued line: another text, a longer text, a text that merely contains ours', async () => {
      const dir = await configWith([{}]);
      const lines = [enqueue('a', 'something else'), enqueue('b', 'salut and more'), enqueue('c', 'please say salut'), enqueue('d', 'sal')];
      const { entries } = await linkWebReplies(lines, SESSION, dir);
      expect(entries.some((entry) => (entry as { webReplyId?: string }).webReplyId !== undefined)).toBe(false);
    });
    it('needs the time: before the send, long after it, or no time at all is not ours', async () => {
      const dir = await configWith([{}]);
      const { entries } = await linkWebReplies([enqueue('a', 'salut', { timestamp: NOW - 5_000 }), enqueue('b', 'salut', { timestamp: NOW + 61_000 }), enqueue('c', 'salut', { timestamp: undefined })], SESSION, dir);
      expect(entries.some((entry) => (entry as { webReplyId?: string }).webReplyId !== undefined)).toBe(false);
    });
    it('a truncated preview must be the start of the reply', async () => {
      const dir = await configWith([{ text: 'a long reply that goes on and on' }]);
      const { entries } = await linkWebReplies([enqueue('a', 'a long reply', { contentTruncated: true }), enqueue('b', 'a long REPLY', { contentTruncated: true }), enqueue('c', 'a long reply')], SESSION, dir);
      expect(entries.map((entry) => (entry as { webReplyId?: string }).webReplyId)).toEqual(['m-abc12345-xyz', undefined, undefined]);
    });
  });

  it('reads no audit when nothing needs it', async () => {
    const dir = join(tmpdir(), 'agent-manager-links-never-created');
    const entries = [{ key: 'u', offset: 0, kind: 'user-prompt', source: 'human', text: 'x', images: [] } as unknown as LogEntry];
    expect(await linkWebReplies(entries, SESSION, dir)).toEqual({ entries, note: '' });
  });

  it('an unreadable audit leaves the entries as they are and says so', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-manager-links-'));
    dirs.push(dir);
    // A file named audit: reading the folder fails with something other than "missing".
    writeFileSync(join(dir, 'audit'), 'not a folder');
    const entry = peer('p', 'salut', wireMsgId('m-abc12345-xyz'));
    const { entries, note } = await linkWebReplies([entry], SESSION, dir);
    expect(entries[0]).toBe(entry);
    expect(note).toContain('The reply audit cannot be read');
    expect(note).toContain(dir);
  });
});
