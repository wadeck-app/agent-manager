import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { removeDir } from '../testFixtures.js';
import { LaunchError } from './errors.js';
import { parseLaunchBody } from './host/validation.js';
import { STATE_FILE_VERSION, ownedStatePath, readOwnedState, writeOwnedState } from './host/stateFile.js';
import type { OwnedSessionRecord } from './host/types.js';
import { buildStreamJsonArgs } from './streamJsonArgs.js';

// Thread = a fork that stops at a message (#65, research/session-fork.md "Mini-fork / side thread", option A): `--resume-session-at <uuid>`.

const SOURCE = '11111111-2222-4333-8444-555555555555';
const FORK = '7b0f6378-600e-4596-bc3c-cfef5f4c6508';
const ANCHOR = '27bf9648-39df-453b-bd04-99816f5c1819';
const FAKE_CLAUDE = fileURLToPath(new URL('./testSupport/fakeClaude.mjs', import.meta.url));

const dirs: string[] = [];
afterEach(() => {
  dirs.splice(0).forEach(removeDir);
});
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'agent-manager-thread-'));
  dirs.push(dir);
  return dir;
}

function launchError(work: () => unknown): LaunchError {
  try {
    work();
  } catch (caught) {
    if (caught instanceof LaunchError) {
      return caught;
    }
    throw caught;
  }
  throw new Error('expected a LaunchError, the call succeeded');
}

describe('buildStreamJsonArgs resumeSessionAt', () => {
  it('puts --resume-session-at after the fork flags, with the uuid as its own argument', () => {
    const args = buildStreamJsonArgs({ forkOf: SOURCE, sessionId: FORK, resumeSessionAt: ANCHOR, model: 'haiku' });
    expect(args.slice(-7)).toEqual(['--resume', SOURCE, '--fork-session', '--session-id', FORK, '--resume-session-at', ANCHOR]);
  });

  it('without resumeSessionAt a fork has no such flag', () => {
    expect(buildStreamJsonArgs({ forkOf: SOURCE, sessionId: FORK })).not.toContain('--resume-session-at');
  });

  it('refuses resumeSessionAt without forkOf (it would silently resume the whole session in place), with a fix', () => {
    for (const options of [{ resumeSessionAt: ANCHOR }, { resume: SOURCE, resumeSessionAt: ANCHOR }, { sessionId: FORK, resumeSessionAt: ANCHOR }]) {
      const failure = launchError(() => buildStreamJsonArgs(options));
      expect(failure.code, JSON.stringify(options)).toBe('resume-at-without-fork');
      expect(failure.fix).toContain('forkOf');
    }
  });

  it('refuses anything that is not a uuid, so a value can never become a flag', () => {
    for (const bad of ['', '--model', '-x', 'abc', `${ANCHOR} --model x`, `${ANCHOR}\n`, '../../x', ANCHOR.slice(1)]) {
      const failure = launchError(() => buildStreamJsonArgs({ forkOf: SOURCE, sessionId: FORK, resumeSessionAt: bad }));
      expect(failure.code, JSON.stringify(bad)).toBe('invalid-resume-session-at');
      expect(failure.fix).not.toBe('');
    }
  });
});

describe('parseLaunchBody resumeSessionAt', () => {
  it('accepts it for a stream-json fork, lower-cased', async () => {
    const request = await parseLaunchBody({ hostKind: 'stream-json', cwd: tempDir(), forkOf: SOURCE, resumeSessionAt: ANCHOR.toUpperCase() });
    expect(request).toMatchObject({ forkOf: SOURCE, resumeSessionAt: ANCHOR });
  });

  it('refuses it without forkOf, with a bad shape, or for hc and bg', async () => {
    const cwd = tempDir();
    const code = async (body: Record<string, unknown>): Promise<string> => {
      try {
        await parseLaunchBody({ cwd, ...body });
      } catch (caught) {
        return (caught as LaunchError).code;
      }
      return 'accepted';
    };
    expect(await code({ hostKind: 'stream-json', resumeSessionAt: ANCHOR })).toBe('resume-at-without-fork');
    expect(await code({ hostKind: 'stream-json', forkOf: SOURCE, resumeSessionAt: '--x' })).toBe('invalid-resume-session-at');
    expect(await code({ hostKind: 'hc', forkOf: SOURCE, resumeSessionAt: ANCHOR })).toBe('fork-host-unsupported');
    expect(await code({ hostKind: 'bg', forkOf: SOURCE, resumeSessionAt: ANCHOR })).toBe('fork-host-unsupported');
    expect(await code({ hostKind: 'stream-json', forkOf: SOURCE, resumeSessionAt: '' })).toBe('invalid-field');
  });
});

describe('owned-sessions.json forkedAtMessage', () => {
  const record: OwnedSessionRecord = { id: FORK, hostKind: 'stream-json', cwd: '/x', claudeVersion: '1', startedAt: 1, status: 'exited' };

  it('keeps it through a write and a read; an older file without it still reads', async () => {
    const path = ownedStatePath(tempDir());
    await writeOwnedState(path, [{ ...record, forkedFrom: SOURCE, forkedAtMessage: ANCHOR }, { ...record, id: SOURCE }]);
    const records = await readOwnedState(path);
    expect(records[0]).toMatchObject({ forkedFrom: SOURCE, forkedAtMessage: ANCHOR });
    expect(records[1]?.forkedAtMessage).toBeUndefined();
  });
});

describe('fakeClaude honours --resume-session-at (the mock of the real flag)', () => {
  function transcript(): string {
    const file = join(tempDir(), `${SOURCE}.jsonl`);
    const user = (uuid: string, text: string) => JSON.stringify({ type: 'user', uuid, message: { role: 'user', content: text } });
    const assistant = (uuid: string, text: string) => JSON.stringify({ type: 'assistant', uuid, message: { role: 'assistant', content: [{ type: 'text', text }] } });
    writeFileSync(file, `${[user('u1', 'word ALPHA'), assistant(ANCHOR, 'OK1'), user('u2', 'word BRAVO'), assistant('a2', 'OK2')].join('\n')}\n`);
    return file;
  }

  /** Runs the fake with the given extra args, sends RECALL and returns what the fake answered, or how it exited when it refused. */
  function ask(extra: string[], file: string): Promise<{ reply?: string; code: number | null; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [FAKE_CLAUDE, '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--resume', SOURCE, '--fork-session', '--session-id', FORK, ...extra], {
        env: { ...process.env, FAKE_CLAUDE_TRANSCRIPT: file },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let out = '';
      let stderr = '';
      let reply: string | undefined;
      child.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString();
        for (const line of out.split('\n')) {
          if (line.includes('"type":"assistant"')) {
            reply = (JSON.parse(line) as { message: { content: { text: string }[] } }).message.content[0]?.text;
          }
          if (line.includes('"type":"result"')) {
            child.stdin.end();
          }
        }
      });
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('error', reject);
      // 'close', not 'exit': on POSIX 'exit' can fire before stdout and stderr are drained.
      child.on('close', (code) => resolve({ ...(reply === undefined ? {} : { reply }), code, stderr }));
      child.stdin.write(`${JSON.stringify({ type: 'user', uuid: 'c0000000-0000-4000-8000-000000000001', message: { role: 'user', content: 'RECALL' } })}\n`);
    });
  }

  it('without the flag the fork knows the whole history', async () => {
    const answer = await ask([], transcript());
    expect(answer.reply).toContain('ALPHA');
    expect(answer.reply).toContain('BRAVO');
  });

  it('with the flag it keeps the lines up to and including the anchor and drops the later ones', async () => {
    const answer = await ask(['--resume-session-at', ANCHOR], transcript());
    expect(answer.reply).toContain('ALPHA');
    expect(answer.reply).not.toContain('BRAVO');
  });

  it('an anchor that is not in the transcript makes it exit 1 with a message on stderr (never a silent full history)', async () => {
    const answer = await ask(['--resume-session-at', '99999999-9999-4999-8999-999999999999'], transcript());
    expect(answer.code).toBe(1);
    expect(answer.stderr).toContain('99999999-9999-4999-8999-999999999999');
    expect(answer.reply).toBeUndefined();
  });
});

describe('owned-sessions.json refuses a thread field that does not make sense (review)', () => {
  const base = { id: FORK, hostKind: 'stream-json', cwd: '/x', claudeVersion: '1', startedAt: 1, status: 'exited' };

  async function readWith(extra: Record<string, unknown>): Promise<LaunchError> {
    const dir = tempDir();
    const path = ownedStatePath(dir);
    writeFileSync(path, JSON.stringify({ version: STATE_FILE_VERSION, sessions: [{ ...base, ...extra }] }));
    try {
      await readOwnedState(path);
    } catch (caught) {
      if (caught instanceof LaunchError) {
        return caught;
      }
      throw caught;
    }
    throw new Error('expected the read to fail');
  }

  it('forkedAtMessage without forkedFrom is refused, naming the file and the fix', async () => {
    const failure = await readWith({ forkedAtMessage: ANCHOR });
    expect(failure.code).toBe('state-file-unreadable');
    expect(failure.reason).toContain('forkedAtMessage');
    expect(failure.reason).toContain('forkedFrom');
    expect(failure.reason).toContain('owned-sessions.json');
    expect(failure.fix).toContain('.bad');
  });

  it('a forkedAtMessage that is not a uuid is refused', async () => {
    const failure = await readWith({ forkedFrom: SOURCE, forkedAtMessage: '--model x' });
    expect(failure.reason).toContain('forkedAtMessage');
    expect(failure.reason).toContain('UUID');
  });

  it('forkedAtQuote without forkedAtMessage, or longer than 80 characters, is refused', async () => {
    expect((await readWith({ forkedFrom: SOURCE, forkedAtQuote: 'q' })).reason).toContain('forkedAtQuote');
    expect((await readWith({ forkedFrom: SOURCE, forkedAtMessage: ANCHOR, forkedAtQuote: 'q'.repeat(81) })).reason).toContain('80');
  });

  it('a valid thread record with its quote reads back', async () => {
    const path = ownedStatePath(tempDir());
    await writeOwnedState(path, [{ ...(base as OwnedSessionRecord), forkedFrom: SOURCE, forkedAtMessage: ANCHOR, forkedAtQuote: 'why red?' }]);
    expect((await readOwnedState(path))[0]).toMatchObject({ forkedAtMessage: ANCHOR, forkedAtQuote: 'why red?' });
  });
});

describe('parseLaunchBody forkedAtQuote (review)', () => {
  const code = async (body: Record<string, unknown>): Promise<string> => {
    try {
      await parseLaunchBody({ hostKind: 'stream-json', cwd: tempDir(), ...body });
    } catch (caught) {
      return (caught as LaunchError).code;
    }
    return 'accepted';
  };

  it('is accepted with an anchor, refused without one, too long, or with a line break', async () => {
    expect(await code({ forkOf: SOURCE, resumeSessionAt: ANCHOR, forkedAtQuote: 'why red?' })).toBe('accepted');
    expect(await code({ forkOf: SOURCE, forkedAtQuote: 'why red?' })).toBe('quote-without-anchor');
    expect(await code({ forkOf: SOURCE, resumeSessionAt: ANCHOR, forkedAtQuote: 'q'.repeat(81) })).toBe('invalid-quote');
    expect(await code({ forkOf: SOURCE, resumeSessionAt: ANCHOR, forkedAtQuote: 'two\nlines' })).toBe('invalid-quote');
  });
});
