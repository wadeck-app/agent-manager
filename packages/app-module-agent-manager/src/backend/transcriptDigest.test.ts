import { mkdirSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SLUG, putSession, textLine, transcriptFile, useSandbox, userLine, writeLines } from './apiFixtures.js';
import { makeModule } from './testKit.js';

// The sub-agents folder cannot be made unreadable portably: its listing fails by a stand-in.
const failing = vi.hoisted(() => ({ message: 'The sub-agents folder cannot be read (EACCES): x. Check the permissions.' }));
vi.mock('@wadeck-app/agent-manager-core/transcript', async (importOriginal) => {
  const original = await importOriginal<typeof import('@wadeck-app/agent-manager-core/transcript')>();
  return {
    ...original,
    listSubagents: async () => ({ ok: false, error: { code: 'unreadable-dir', message: failing.message, fix: 'Retry.' } }),
  };
});

const box = useSandbox();
const rows = async () => (await makeModule({ dataDir: box.data }).call('GET', '/sessions')).body;
const noteOf = (body: { sessions: { sessionId: string; activityNote: string; lastActivity: string }[] }, id: string) => body.sessions.find((row) => row.sessionId === id)!;

describe('the transcript digest notes', () => {
  it('keeps the sub-agent note when only the transcript changes, and does not repeat it when only the sub-agents folder changes', async () => {
    const id = putSession(box, process.pid);
    const file = transcriptFile(box, id);
    writeLines(file, [userLine(1, 'go')]);
    const sub = join(box.projects, SLUG, id, 'subagents');
    mkdirSync(sub, { recursive: true });
    expect(noteOf(await rows(), id).activityNote).toBe(failing.message);
    // only the transcript changed: the note of the sub-agents is still there
    writeLines(file, [textLine(2, 'more')], true);
    const second = noteOf(await rows(), id);
    expect(second.lastActivity).toBe('more');
    expect(second.activityNote).toBe(failing.message);
    // only the folder changed: the note is the same, not twice
    const later = new Date(Date.now() + 5_000);
    utimesSync(sub, later, later);
    expect(noteOf(await rows(), id).activityNote).toBe(failing.message);
  });
});
