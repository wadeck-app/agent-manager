import { describe, expect, it } from 'vitest';
import { putSession, useSandbox } from './apiFixtures.js';
import { putCounters, useHome } from './guardrailsFixtures.js';
import { makeModule } from './testKit.js';

// Temp folders only. Two registry sessions are alive here: this process and its parent.
const box = useSandbox();
const home = useHome();

function mod(): ReturnType<typeof makeModule> {
  return makeModule({ dataDir: box.data, options: { guardrails: { homeDir: home.home } } });
}

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'aaaaaaaa-0000-4000-8000-000000000002';

describe('sessions that share the first 8 characters of their id', () => {
  it('the exact counters keep their chip, the other session gets none (never the counters of its namesake), and the overview lists the ambiguity', async () => {
    const project = home.project('twins');
    putSession(box, process.pid, { cwd: project, sessionId: A });
    putSession(box, process.ppid, { cwd: project, sessionId: B });
    putCounters(project, { requests: { [A]: { block_counts: { 'git-push': 4 } } } });
    const { body } = await mod().call('GET', '/sessions');
    const byId = Object.fromEntries(body.sessions.map((s: { sessionId: string }) => [s.sessionId, s]));
    expect(byId[A].guardrailBlocks).toMatchObject({ total: 4 });
    expect(byId[B]).not.toHaveProperty('guardrailBlocks');
    expect(body.guardrailsErrorText).toMatch(/1 session\(s\) share an 8-character id prefix.*ambiguous session prefix/);
    const overview = (await mod().call('GET', '/guardrails/overview')).body;
    expect(overview.problems.map((p: { message: string }) => p.message).join(' ')).toMatch(/ambiguous session prefix aaaaaaaa/);
  });

  it('a counter keyed by the 8 characters only is given to neither of two sessions with that prefix', async () => {
    const project = home.project('twins-short');
    putSession(box, process.pid, { cwd: project, sessionId: A });
    putSession(box, process.ppid, { cwd: project, sessionId: B });
    putCounters(project, { requests: { aaaaaaaa: { block_counts: { kill: 2 } } } });
    const both = (await mod().call('GET', '/sessions')).body;
    expect(both.sessions.some((s: { guardrailBlocks?: unknown }) => s.guardrailBlocks !== undefined)).toBe(false);
    expect(both.guardrailsErrorText).toMatch(/2 session\(s\) share an 8-character id prefix/);
  });

  it('a counter keyed by the 8 characters only is given to a session that is alone with that prefix', async () => {
    const project = home.project('lone-short');
    putSession(box, process.pid, { cwd: project, sessionId: A });
    putCounters(project, { requests: { aaaaaaaa: { block_counts: { kill: 2 } } } });
    const { body } = await mod().call('GET', '/sessions');
    expect(body.sessions.find((s: { sessionId: string }) => s.sessionId === A).guardrailBlocks).toMatchObject({ total: 2 });
    expect(body.guardrailsErrorText).toBe('');
  });
});
