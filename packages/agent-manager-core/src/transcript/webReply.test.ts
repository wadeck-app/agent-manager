import { afterEach, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { parseWebReply } from './webReply.js';
import { TranscriptTailer } from './tailer.js';
import type { UserPromptEntry } from './types.js';
import { humanPrompt, jsonl, makeTempDir, peerPrompt, removeDir, writeText } from './testFixtures.js';

// The shape of a real delivered reply (trimmed): the wrapper paragraph, the marker line, the text, the trailer.
const REAL = 'Another Claude session sent a message:\n[web reply via agent-manager #m-mwi1unxx-n1uaa7hq]\nsalut\n\nThis came from another Claude session. Reply to it with the tool provided for that.';

describe('parseWebReply', () => {
  it('returns the id of the marker and the text after it, without the trailer', () => {
    expect(parseWebReply(REAL)).toEqual({ messageId: 'm-mwi1unxx-n1uaa7hq', text: 'salut' });
  });

  it('keeps a multi-line text and the image line, cuts only the trailer', () => {
    const text = 'Another Claude session sent a message:\n[web reply via agent-manager #m1]\nline one\nline two\nThe user attached an image: C:\\a.png. Read it.\n\nThis came from another Claude session. Reply.';
    expect(parseWebReply(text)).toEqual({ messageId: 'm1', text: 'line one\nline two\nThe user attached an image: C:\\a.png. Read it.' });
  });

  it('works without the wrapper paragraph or the trailer, and is undefined for a real peer message', () => {
    expect(parseWebReply('[web reply via agent-manager #m2]\nhello')).toEqual({ messageId: 'm2', text: 'hello' });
    expect(parseWebReply('Another Claude session sent a message:\nplease review the PR')).toBeUndefined();
    expect(parseWebReply('')).toBeUndefined();
  });

  it('is anchored: a marker quoted further down a message is not ours', () => {
    expect(parseWebReply('Another Claude session sent a message:\nplease look at this log line: [web reply via agent-manager #m9] and tell me')).toBeUndefined();
    expect(parseWebReply('see [web reply via agent-manager #m9]\nabove')).toBeUndefined();
  });
});

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(removeDir));

describe('webReply on a transcript entry', () => {
  it('is set on the peer entry, the full text is kept', async () => {
    const dir = makeTempDir();
    dirs.push(dir);
    const path = join(dir, 's.jsonl');
    writeText(path, jsonl([peerPrompt(1, REAL), peerPrompt(2, 'Another Claude session sent a message:\nplease review')]));
    const entries = (await new TranscriptTailer().readNew(path)).entries.filter((entry): entry is UserPromptEntry => entry.kind === 'user-prompt');
    expect(entries[0]?.webReply).toEqual({ messageId: 'm-mwi1unxx-n1uaa7hq', text: 'salut' });
    expect(entries[0]?.text).toBe(REAL);
    expect(entries[1]?.webReply).toBeUndefined();
  });
});

describe('webReply only on peer entries', () => {
  it('a typed prompt that contains the marker, and a quoted peer message, are not web replies', async () => {
    const dir = makeTempDir();
    dirs.push(dir);
    const path = join(dir, 's.jsonl');
    const pasted = '[web reply via agent-manager #m-pasted]\nI pasted this line from an old log';
    writeText(path, jsonl([humanPrompt(1, pasted), peerPrompt(2, 'Another Claude session sent a message:\nlook: [web reply via agent-manager #m-quoted] is what we sent'), peerPrompt(3, REAL)]));
    const entries = (await new TranscriptTailer().readNew(path)).entries.filter((entry): entry is UserPromptEntry => entry.kind === 'user-prompt');
    expect(entries[0]?.webReply).toBeUndefined();
    expect(entries[1]?.webReply).toBeUndefined();
    expect(entries[2]?.webReply?.messageId).toBe('m-mwi1unxx-n1uaa7hq');
  });
});
