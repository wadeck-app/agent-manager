import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ID, SLUG, transcriptFile, useSandbox, userLine } from './apiFixtures.js';
import { latestTranscriptCwd } from './transcriptCwd.js';

const box = useSandbox();
const lines = (...items: object[]): string => `${items.map((item) => JSON.stringify(item)).join('\n')}\n`;
const withCwd = (cwd: string, seconds = 1): object => ({ ...userLine(seconds, 'hello'), cwd });

describe('latestTranscriptCwd: the folder Claude Code reports NOW for a session (the plugin hook uses event.cwd as it is)', () => {
  it('is the cwd of the LAST line that has one, so a session that ran cd is found in its new folder', async () => {
    writeFileSync(transcriptFile(box, ID(1)), lines(withCwd('/proj/a', 1), withCwd('/proj/b', 2), { type: 'summary', summary: 'no cwd here' }));
    expect(await latestTranscriptCwd({ sessionId: ID(1), cwd: '/proj/a' })).toEqual({ ok: true, cwd: '/proj/b' });
  });

  it('reads only the end of a big transcript, and ignores the half line at the cut', async () => {
    const filler = 'x'.repeat(400_000);
    writeFileSync(transcriptFile(box, ID(2)), lines(withCwd('/old', 1), { type: 'attachment', pad: filler }, withCwd('/new', 2)));
    expect(await latestTranscriptCwd({ sessionId: ID(2), cwd: '/old' }, { tailBytes: 64 * 1024 })).toEqual({ ok: true, cwd: '/new' });
  });

  it('a transcript without any cwd in its tail is a problem sentence, not the registry folder in disguise', async () => {
    writeFileSync(transcriptFile(box, ID(3)), lines({ type: 'summary', summary: 's' }));
    const result = await latestTranscriptCwd({ sessionId: ID(3), cwd: '/work/shop' });
    expect(result).toMatchObject({ ok: false });
    expect(result.ok ? '' : result.problem).toMatch(/no line with a cwd/);
  });

  it('no transcript is a problem sentence naming the folder looked in', async () => {
    const result = await latestTranscriptCwd({ sessionId: ID(4), cwd: '/work/shop' });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.problem).toContain(box.projects);
    expect(SLUG).toBe('-work-shop');
  });
});
