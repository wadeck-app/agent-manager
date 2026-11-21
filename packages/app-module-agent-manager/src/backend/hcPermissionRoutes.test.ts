import { ReplyError, type HcApproval, type HcApprovalDecision, type HcDecisionResult, type HcPromptState } from '@wadeck-app/agent-manager-core/reply';
import { describe, expect, it } from 'vitest';
import { NOT_SENSITIVE_APPROVAL_READ_ROUTES, SENSITIVE_ROUTES } from '../commons/routeClasses.js';
import { ID, deadPid, putSession, useSandbox } from './apiFixtures.js';
import { makeModule } from './testKit.js';

const box = useSandbox();

const PROMPT = {
  promptId: '0123456789abcdef',
  terminal: 't21',
  tool: 'Bash',
  header: 'Bash command',
  description: 'Create am-allow.txt file',
  body: 'touch am-allow.txt',
  question: 'Do you want to proceed?',
  options: [
    { number: 1, label: 'Yes' },
    { number: 2, label: 'Yes, and always allow access to C:\\proj from this project' },
    { number: 3, label: 'No' },
  ],
  statusMessage: 'approve Bash: touch am-allow.txt',
};

interface FakeApproval extends HcApproval {
  decisions: { decision: HcApprovalDecision; promptId: string }[];
}

/** An approval of this test process: it answers what the test says and types nothing anywhere. */
function fakeApproval(over: { state?: HcPromptState | Error; decide?: HcDecisionResult | Error } = {}): FakeApproval {
  const decisions: FakeApproval['decisions'] = [];
  return {
    decisions,
    read: () => (over.state instanceof Error ? Promise.reject(over.state) : Promise.resolve(over.state ?? { kind: 'prompt', prompt: PROMPT })),
    decide: (_session, decision, promptId) => {
      decisions.push({ decision, promptId });
      const outcome = over.decide ?? { decision, promptId, terminal: 't21', keys: decision === 'allow' ? ['enter'] : ['esc'], tool: 'Bash', effect: 'closed' as const, note: '', statusAfter: 'working' };
      return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
    },
  };
}

const module_ = (approval: HcApproval) => makeModule({ dataDir: box.data, options: { hcApproval: approval } });

describe('GET /sessions/:sessionId/hc-permission', () => {
  it('answers the dialog of the terminal: tool, command, options and the prompt id', async () => {
    const id = putSession(box, process.pid);
    const { status, body } = await module_(fakeApproval()).call('GET', `/sessions/${id}/hc-permission`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, sessionId: id, state: 'prompt', prompt: { promptId: PROMPT.promptId, terminal: 't21', tool: 'Bash', body: 'touch am-allow.txt', description: 'Create am-allow.txt file' } });
    expect(body.prompt.options).toHaveLength(3);
  });

  it('says "none" when the terminal is not blocked, and "unsupported" with its fix for a dialog it does not answer', async () => {
    const id = putSession(box, process.pid);
    const none = await module_(fakeApproval({ state: { kind: 'none', terminal: 't21', status: 'working' } })).call('GET', `/sessions/${id}/hc-permission`);
    expect(none.body).toEqual({ ok: true, sessionId: id, state: 'none', terminal: 't21', status: 'working' });
    const unsupported = await module_(fakeApproval({ state: { kind: 'unsupported', terminal: 't21', code: 'dialog-not-recognized', reason: 'it is the trust dialog', fix: 'answer it in its terminal' } })).call('GET', `/sessions/${id}/hc-permission`);
    expect(unsupported.body).toMatchObject({ ok: true, state: 'unsupported', code: 'dialog-not-recognized', fix: 'answer it in its terminal' });
  });

  it('a session that was not started in a herdr-core terminal is data (HTTP 200, ok false) with the reason and the fix', async () => {
    const id = putSession(box, process.pid);
    const error = new ReplyError('no-terminal', 'no herdr-core terminal runs the session process (pid 1): the session was not started in a herdr-core terminal', 'start the session with `hc run --bg claude`');
    const { status, body } = await module_(fakeApproval({ state: error })).call('GET', `/sessions/${id}/hc-permission`);
    expect(status).toBe(200);
    expect(body).toEqual({ ok: false, error: { code: 'no-terminal', message: expect.stringMatching(/started in a herdr-core terminal/), hint: expect.stringMatching(/hc run --bg claude/) } });
  });

  it('hc missing is data too, with the install fix', async () => {
    const id = putSession(box, process.pid);
    const error = new ReplyError('hc-missing', "the program 'hc' was not found", 'install herdr-core and put `hc` on the PATH');
    const { status, body } = await module_(fakeApproval({ state: error })).call('GET', `/sessions/${id}/hc-permission`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: false, error: { code: 'hc-missing', hint: expect.stringMatching(/PATH/) } });
  });

  it('a dead session and an unknown session are refused with their own message', async () => {
    const dead = putSession(box, deadPid());
    expect((await module_(fakeApproval()).call('GET', `/sessions/${dead}/hc-permission`)).body).toMatchObject({ ok: false, error: { code: 'session-dead' } });
    const unknown = await module_(fakeApproval()).call('GET', `/sessions/${ID(999)}/hc-permission`);
    expect(unknown.status).toBe(404);
  });
});

describe('PIN class of the two routes (T-01, T-15)', () => {
  it('the read is a documented not-sensitive read, the answer is sensitive', () => {
    const { registered } = module_(fakeApproval());
    expect(NOT_SENSITIVE_APPROVAL_READ_ROUTES).toEqual(['GET /sessions/:sessionId/hc-permission']);
    expect(registered.find((route) => route.key === NOT_SENSITIVE_APPROVAL_READ_ROUTES[0])?.effect).toBeUndefined();
    expect(SENSITIVE_ROUTES).not.toContain(NOT_SENSITIVE_APPROVAL_READ_ROUTES[0]);
    expect(SENSITIVE_ROUTES).toContain('POST /sessions/:sessionId/hc-permission');
  });
});

describe('POST /sessions/:sessionId/hc-permission', () => {
  const post = (approval: HcApproval, id: string, body: unknown) => module_(approval).call('POST', `/sessions/${id}/hc-permission`, { body });

  it('allow once: passes the prompt id, answers the keys typed and what the terminal did', async () => {
    const id = putSession(box, process.pid);
    const approval = fakeApproval();
    const { status, body } = await post(approval, id, { decision: 'allow', promptId: PROMPT.promptId });
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, sessionId: id, decision: 'allow', promptId: PROMPT.promptId, terminal: 't21', keys: ['enter'], tool: 'Bash', effect: 'closed', note: '', statusAfter: 'working' });
    expect(approval.decisions).toEqual([{ decision: 'allow', promptId: PROMPT.promptId }]);
  });

  it('deny: types esc', async () => {
    const id = putSession(box, process.pid);
    const { body } = await post(fakeApproval(), id, { decision: 'deny', promptId: PROMPT.promptId });
    expect(body).toMatchObject({ ok: true, decision: 'deny', keys: ['esc'] });
  });

  it('prompt-changed, already-answered, not-blocked and no-terminal are 409 with the fix, and nothing else', async () => {
    const id = putSession(box, process.pid);
    for (const code of ['prompt-changed', 'already-answered', 'not-blocked', 'no-terminal', 'dialog-not-recognized', 'terminal-gone']) {
      const error = new ReplyError(code, `reason of ${code}`, `fix of ${code}`);
      const { status, body } = await post(fakeApproval({ decide: error }), id, { decision: 'allow', promptId: PROMPT.promptId });
      expect(status, code).toBe(409);
      expect(body, code).toMatchObject({ ok: false, error: { code, message: `reason of ${code}`, hint: `fix of ${code}` } });
    }
  });

  it('a failure of hc or of the audit is 502 with its fix', async () => {
    const id = putSession(box, process.pid);
    for (const code of ['hc-keys-failed', 'audit-unwritable', 'hc-timeout', 'hc-missing']) {
      const { status, body } = await post(fakeApproval({ decide: new ReplyError(code, 'x', 'y') }), id, { decision: 'deny', promptId: PROMPT.promptId });
      expect(status, code).toBe(502);
      expect(body.error.code).toBe(code);
    }
  });

  it('refuses a body that is not exactly {decision: allow|deny, promptId}, before asking anything (no always-allow)', async () => {
    const id = putSession(box, process.pid);
    const approval = fakeApproval();
    const cases: [unknown, string][] = [
      [undefined, 'bad-request'],
      [{ decision: 'allow' }, 'bad-request'],
      [{ decision: 'always', promptId: PROMPT.promptId }, 'invalid-decision'],
      [{ decision: 'allow', promptId: 'x' }, 'bad-request'],
      [{ decision: 'allow', promptId: PROMPT.promptId, keys: ['2'] }, 'bad-request'],
    ];
    for (const [body, code] of cases) {
      const answer = await post(approval, id, body);
      expect(answer.status, JSON.stringify(body)).toBe(400);
      expect(answer.body.error.code).toBe(code);
    }
    expect(approval.decisions).toEqual([]);
  });

  it('an outcome that could not be checked is passed on with its note', async () => {
    const id = putSession(box, process.pid);
    const unknown = { decision: 'allow' as const, promptId: PROMPT.promptId, terminal: 't21', keys: ['enter'], tool: 'Bash', effect: 'unknown' as const, note: 'the key was sent, check the terminal t21', statusAfter: 'unknown' };
    const { status, body } = await post(fakeApproval({ decide: unknown }), id, { decision: 'allow', promptId: PROMPT.promptId });
    expect(status).toBe(200);
    expect(body).toMatchObject({ ok: true, effect: 'unknown', note: 'the key was sent, check the terminal t21' });
  });

  it('a dead session is refused, nothing typed', async () => {
    const dead = putSession(box, deadPid());
    const approval = fakeApproval();
    const answer = await post(approval, dead, { decision: 'allow', promptId: PROMPT.promptId });
    expect(answer.status).toBe(409);
    expect(answer.body.error.code).toBe('session-dead');
    expect(approval.decisions).toEqual([]);
  });

  it('is a sensitive route (PIN) and needs the CSRF header', async () => {
    const m = module_(fakeApproval());
    expect(m.registered.find((route) => route.key === 'POST /sessions/:sessionId/hc-permission')?.effect).toBe('sensitive');
    const id = putSession(box, process.pid);
    const answer = await m.call('POST', `/sessions/${id}/hc-permission`, { body: { decision: 'allow', promptId: PROMPT.promptId }, headers: { 'sec-fetch-site': undefined } });
    expect(answer.status).toBe(403);
  });
});
