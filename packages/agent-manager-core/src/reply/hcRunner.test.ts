import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ReplyError } from './errors.js';
import { createHcRunner } from './hcRunner.js';

const FAKE_OUTPUT = fileURLToPath(new URL('../launch/testSupport/fakeOutput.mjs', import.meta.url));
const runner = createHcRunner({ command: process.execPath, commandArgs: [FAKE_OUTPUT] });

async function failure(promise: Promise<unknown>): Promise<ReplyError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ReplyError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a ReplyError, the promise resolved');
}

describe('hcRunner output collection', () => {
  it('keeps a multi-byte character that is split between two chunks', async () => {
    const run = await runner.run(['split'], 20_000, 'test');
    expect(run.stdout).toBe('{\u00e9}\n');
  });

  it('counts bytes, not characters, stops collecting at the cap and stops the child', async () => {
    // 1.2 million characters are under the cap counted in characters, 2.4 MB are over it counted in bytes.
    expect((await failure(runner.run(['big-bytes'], 20_000, 'test'))).code).toBe('hc-output-too-large');
  });

  it('stops a program that does not answer and gives the fix it was told', async () => {
    const error = await failure(runner.run(['hang'], 200, 'test', 'custom fix text'));
    expect(error.code).toBe('hc-timeout');
    expect(error.fix).toBe('custom fix text');
  });
});
