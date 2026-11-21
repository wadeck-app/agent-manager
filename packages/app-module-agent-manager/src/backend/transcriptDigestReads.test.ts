import { describe, expect, it, vi } from 'vitest';
import { putSession, textLine, toolUseLine, transcriptFile, useSandbox, userLine, writeLines } from './apiFixtures.js';
import { clearDigestCache, digestOf } from './transcriptDigest.js';
import type { ReadInFlightOptions } from '@wadeck-app/agent-manager-core/transcript';

// The seam: readInFlight is wrapped to record the options of each call (what the digest hands over instead of making it read the file again).
const calls = vi.hoisted(() => ({ options: [] as (ReadInFlightOptions | undefined)[] }));
vi.mock('@wadeck-app/agent-manager-core/transcript', async (importOriginal) => {
  const original = await importOriginal<typeof import('@wadeck-app/agent-manager-core/transcript')>();
  return {
    ...original,
    readInFlight: (path: string, options?: ReadInFlightOptions) => {
      calls.options.push(options);
      return original.readInFlight(path, options);
    },
  };
});

const box = useSandbox();

describe('the digest reads the end of the transcript once', () => {
  it('hands the tail it already read to readInFlight, with the same in-flight facts as a read of the file', async () => {
    clearDigestCache();
    calls.options.length = 0;
    const id = putSession(box, process.pid);
    writeLines(transcriptFile(box, id), [userLine(1, 'go'), toolUseLine(2, 't1', 'Bash', { command: 'node wait.mjs' }), textLine(3, 'waiting')]);
    const digest = await digestOf({ sessionId: id, cwd: '/work/shop' } as Parameters<typeof digestOf>[0], Date.now());
    expect(calls.options).toHaveLength(1);
    expect(calls.options[0]?.firstWindow).toBeDefined();
    expect(digest.inFlight).toMatchObject({ ok: true, facts: { coversLastTurn: true, reachedStart: true } });
    expect(digest.inFlight.ok && digest.inFlight.facts.openCalls.map((call) => call.id)).toEqual(['t1']);
  });
});
