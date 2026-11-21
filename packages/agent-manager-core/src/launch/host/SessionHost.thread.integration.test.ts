import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { TranscriptTailer } from '../../transcript/tailer.js';
import { projectSlug, resolveProjectsDir, transcriptPath } from '../../transcript/transcriptPath.js';
import { StreamJsonSession } from '../StreamJsonSession.js';
import { SessionHost } from './SessionHost.js';

/*
 * INTEGRATION test of the thread (#65): the ONE test that runs the real `claude` (Haiku). Pattern of agent-fleet (research/session-fork.md, "Test strategy, from
 * agent-fleet"): every other test uses the fake claude; this one proves that the real CLI still honours the hidden flag `--resume-session-at`, which is the
 * only thing a mock cannot prove. It is the tripwire for a Claude Code release that drops or changes the flag.
 *
 * Gate: AGENT_MANAGER_INTEGRATION=1. Absent: the test is REPORTED as skipped, with the reason in its title (never a silent pass). Present: nothing is skipped
 * any more, a missing `claude` or a missing credential FAILS with what to do.
 * Cost: 3 Haiku prompts (2 to build the source session, 1 asked in the thread), one claude process at a time, no loop. Run it on demand, not in a loop.
 */

const GATE = 'AGENT_MANAGER_INTEGRATION';
const enabled = process.env[GATE] === '1';
const TITLE = enabled
  ? 'a thread at message 1 knows ALPHA but not BRAVO, and the source transcript is untouched (real claude, 3 Haiku prompts)'
  : `SKIPPED, set ${GATE}=1 to run (real claude, 3 Haiku prompts): a thread at message 1 knows ALPHA but not BRAVO`;
const QUESTION = 'List every secret word I gave you in this conversation, as a comma separated list, nothing else. If none, answer NONE.';
const TEMP_PREFIX = 'agent-manager-thread-it-';

/** The environment of a real run: the test isolation redirects HOME and friends, but a real claude needs the real ones (credentials, settings). */
function realEnvironment(): NodeJS.ProcessEnv {
  const saved = process.env['AGENT_MANAGER_TEST_REAL_ENV'];
  if (saved === undefined) {
    throw new Error(`${GATE}=1 needs the real environment saved by test-support/guardRealConfig.ts (AGENT_MANAGER_TEST_REAL_ENV): run this test through the vitest config of the package (npm test --workspace=packages/agent-manager-core), not by another runner`);
  }
  const real = JSON.parse(saved) as Record<string, string>;
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME']) {
    const value = real[name];
    if (value === undefined) {
      delete env[name];
    } else {
      env[name] = value;
    }
  }
  return env;
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

const cleanups: (() => Promise<void> | void)[] = [];
afterAll(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    await cleanup();
  }
});

describe('thread against the real claude', () => {
  it.skipIf(!enabled)(TITLE, async () => {
    const env = realEnvironment();
    const version = spawnSync('claude', ['--version'], { env, encoding: 'utf8', windowsHide: true });
    if (version.error !== undefined || version.status !== 0) {
      throw new Error(`${GATE}=1 but \`claude --version\` failed (${version.error?.message ?? `exit ${String(version.status)}: ${version.stderr}`}): install Claude Code and log in, or unset ${GATE}`);
    }

    // A fresh folder: its transcripts are the ones this test creates and removes.
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), TEMP_PREFIX)));
    const home = env['HOME'] ?? env['USERPROFILE'] ?? homedir();
    const projectsDir = resolveProjectsDir(env, home);
    const projectDir = join(projectsDir, projectSlug(cwd));
    cleanups.push(() => {
      // Only the project folder of THIS temp folder is removed (the name is checked, never a loose path).
      if (basename(cwd).startsWith(TEMP_PREFIX) && projectDir.startsWith(projectsDir) && projectSlug(cwd).includes(projectSlug(TEMP_PREFIX))) {
        rmSync(projectDir, { recursive: true, force: true });
      }
      rmSync(cwd, { recursive: true, force: true });
    });

    // Prompts 1 and 2: one process, two messages (the session of poc/scripts/fork-test.mjs).
    const source = await StreamJsonSession.start({ cwd, env, model: 'haiku', permissionMode: 'default' });
    cleanups.push(async () => void (await source.kill().catch(() => undefined)));
    await (await source.send('The first secret word is ALPHA. Remember it. Reply exactly OK1. No tools.')).completed;
    await (await source.send('Another secret word is BRAVO. Reply exactly OK2. No tools.')).completed;
    await source.close();
    const sourceId = source.sessionId;

    const located = await transcriptPath(cwd, sourceId, projectsDir);
    if (!located.ok) {
      throw new Error(`the source transcript was not written: ${JSON.stringify(located.error)}`);
    }
    const sourceFile = located.path;
    const sourceBefore = sha256(sourceFile);
    // The anchor: the uuid the reader gives to the assistant text of message 1 (also proves that real entries carry a uuid).
    const parsed = await new TranscriptTailer().readNew(sourceFile);
    expect(parsed.error).toBeUndefined();
    const anchor = parsed.entries.find((entry) => entry.kind === 'assistant-text' && entry.text.includes('OK1'));
    expect(anchor?.uuid, 'the entry of the reply OK1 has no uuid').toBeDefined();

    // Prompt 3: the thread, launched by the real host (the code path of the daemon), asked what it knows.
    const configDir = join(cwd, 'config');
    mkdirSync(configDir, { recursive: true });
    const host = new SessionHost({ configDir, claude: { command: 'claude', env } });
    cleanups.push(() => host.shutdown());
    await host.init();
    const thread = await host.launch({ hostKind: 'stream-json', cwd, model: 'haiku', permissionMode: 'default', name: 'thread: integration', forkOf: sourceId, resumeSessionAt: anchor?.uuid as string });
    expect(thread).toMatchObject({ forkedFrom: sourceId, forkedAtMessage: anchor?.uuid });
    const sent = await host.send(thread.id, { text: QUESTION, images: [] });
    const deadline = Date.now() + 180_000;
    for (;;) {
      const view = host.list().find((item) => item.id === thread.id);
      const state = view?.messages.find((message) => message.uuid === sent.uuid)?.state;
      if (state === 'completed') {
        break;
      }
      if (view?.state === 'exited' || state === 'cancelled' || state === 'lost' || Date.now() > deadline) {
        // A claude that dropped the flag exits at once: its stderr is the evidence the user needs.
        throw new Error(`the thread did not answer (state ${String(state)}, session ${String(view?.state)}): claude stderr tail: ${view?.exit?.stderrTail ?? '(none)'}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    const threadLocated = await transcriptPath(cwd, thread.id, projectsDir);
    if (!threadLocated.ok) {
      throw new Error(`the thread transcript was not written: ${JSON.stringify(threadLocated.error)}`);
    }
    const threadText = readFileSync(threadLocated.path, 'utf8');
    const reply = (await new TranscriptTailer().readNew(threadLocated.path)).entries.filter((entry) => entry.kind === 'assistant-text').at(-1);
    expect(reply?.kind === 'assistant-text' ? reply.text : '', 'the thread answered nothing').not.toBe('');
    const answerText = reply?.kind === 'assistant-text' ? reply.text : '';
    expect(answerText).toContain('ALPHA');
    expect(answerText).not.toContain('BRAVO');
    // Nothing of message 2 is in the file of the thread at all (the copy stopped at the anchor).
    expect(threadText).not.toContain('BRAVO');
    expect(sha256(sourceFile), 'the source transcript changed').toBe(sourceBefore);
  });
});
