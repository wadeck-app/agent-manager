import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubFetch, type Call, type FakeAnswer } from '../owned/testFetch.js';
import { row } from '../logic/fixtures.js';
import type { BatchGrantResult, BatchRevokeResult, CliGrantDto, RuleCategoryDto, SessionGrantsDto, SessionRulesDto } from '../shared.js';
import { BatchAddBypassDialog } from './BatchAddBypassDialog.js';
import { BatchRemoveBypassDialog } from './BatchRemoveBypassDialog.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const CSRF = { 'GET /csrf': { body: { header: 'x-agent-manager-csrf', token: 't' } } };
const rule = (name: string, over: Partial<RuleCategoryDto> = {}): RuleCategoryDto => ({ name, decision: 'deny', source: 'default', bypassable: true, hardcoded: false, ...over });
const rulesOf = (sessionId: string, cwd: string, categories: RuleCategoryDto[]): SessionRulesDto => ({ ok: true, code: '', sessionId, cwd, cwdNote: '', configPath: '', configPresent: false, configError: '', categories, errorText: '' });

const shopA = row({ displayName: 'shop-owner', cwd: '/w/shop' });
const shopB = row({ displayName: 'shop-helper', cwd: '/w/shop' });
const api = row({ displayName: 'api-owner', cwd: '/w/api' });
const rows = [shopA, shopB, api];

const RULES = (id: string): string => `GET /guardrails/sessions/${id}/rules`;
const GRANTS = (id: string): string => `GET /guardrails/sessions/${id}/grants`;
const ADD = 'POST /guardrails/batch/grants';
const REVOKE = 'POST /guardrails/batch/revoke';

/** The rules routes: /w/shop lifts rm and git-push, /w/api lifts rm and kill. Only the first session of a folder is asked. */
function rulesRoutes(): Record<string, FakeAnswer> {
  return {
    [RULES(shopA.sessionId)]: { body: rulesOf(shopA.sessionId, '/w/shop', [rule('rm'), rule('git-push'), rule('ssh-config', { bypassable: false, hardcoded: true })]) },
    [RULES(api.sessionId)]: { body: rulesOf(api.sessionId, '/w/api', [rule('rm'), rule('kill')]) },
  };
}

const granted = (target: typeof shopA, id: string): BatchGrantResult => ({ sessionId: target.sessionId, name: target.displayName, status: 'granted', code: '', text: 'Granted rm (once)', id });
const post = (calls: Call[], path: string): Call | undefined => calls.find((call) => call.method === 'POST' && call.path === path);

async function fillAndSubmit(dialog: HTMLElement): Promise<void> {
  await within(dialog).findByText(/Allow rm once in 3 sessions/);
  fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'clean the build folders' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add bypass' }));
}

describe('BatchAddBypassDialog', () => {
  it('shows the count and the names, asks the rules once per distinct folder, and lists only the categories that a bypass lifts in EVERY folder', async () => {
    const { calls } = stubFetch({ ...CSRF, ...rulesRoutes() });
    render(<BatchAddBypassDialog rows={rows} onClose={vi.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: 'Add a bypass to 3 sessions' });
    for (const name of ['shop-owner', 'shop-helper', 'api-owner']) {
      expect(within(dialog).getByText(name)).toBeInTheDocument();
    }
    const select = await within(dialog).findByLabelText(/Category/);
    await waitFor(() => expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['rm: denied (default)']));
    expect(calls.filter((call) => call.path.endsWith('/rules')).map((call) => call.path).sort()).toEqual([`/guardrails/sessions/${shopA.sessionId}/rules`, `/guardrails/sessions/${api.sessionId}/rules`].sort());
    expect(within(dialog).getByText(/can be bypassed in every selected folder/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add bypass' })).toBeDisabled();
  });

  it('collapses the names above 5 sessions, lists them below', async () => {
    const many = Array.from({ length: 6 }, (_, index) => row({ displayName: `agent-${index}`, cwd: '/w/shop' }));
    stubFetch({ ...CSRF, [RULES(many[0]?.sessionId ?? '')]: { body: rulesOf('x', '/w/shop', [rule('rm')]) } });
    const { unmount } = render(<BatchAddBypassDialog rows={many} onClose={vi.fn()} />);
    const dialog = await screen.findByRole('dialog');
    const details = dialog.querySelector('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(within(dialog).getByText('6 sessions')).toBeInTheDocument();
    unmount();
    stubFetch({ ...CSRF, ...rulesRoutes() });
    render(<BatchAddBypassDialog rows={rows} onClose={vi.fn()} />);
    expect((await screen.findByRole('dialog')).querySelector('details')).toBeNull();
  });

  it('a folder whose rules cannot be read is said, with its sessions: the server will refuse them one by one', async () => {
    stubFetch({
      ...CSRF,
      [RULES(shopA.sessionId)]: { body: rulesOf(shopA.sessionId, '/w/shop', [rule('rm')]) },
      [RULES(api.sessionId)]: { body: { ...rulesOf(api.sessionId, '/w/api', []), ok: false, code: 'timeout', errorText: 'The plugin did not answer in 10 s. Retry.' } },
    });
    render(<BatchAddBypassDialog rows={rows} onClose={vi.fn()} />);
    const dialog = await screen.findByRole('dialog');
    const warning = await within(dialog).findByText(/The categories could not be read for api-owner/);
    expect(warning).toHaveTextContent(/The plugin did not answer in 10 s/);
    expect(warning).toHaveTextContent(/refuses them one by one/);
  });

  it('the confirm line follows the choices; the button needs a reason', async () => {
    stubFetch({ ...CSRF, ...rulesRoutes() });
    render(<BatchAddBypassDialog rows={rows} onClose={vi.fn()} />);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Allow rm once in 3 sessions');
    fireEvent.click(within(dialog).getByRole('button', { name: '30 min' }));
    expect(within(dialog).getByText('Allow rm for 30 min in 3 sessions')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add bypass' })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'because' } });
    expect(within(dialog).getByRole('button', { name: 'Add bypass' })).toBeEnabled();
  });

  it('sends one request with the full session ids, then lists granted, refused (with the reason) and not attempted per session', async () => {
    const answer: BatchGrantResult[] = [
      granted(shopA, 'c0ffee01'),
      { sessionId: shopB.sessionId, name: shopB.displayName, status: 'refused', code: 'not-bypassable', text: "'rm' cannot be bypassed: it is hardcoded in the plugin" },
      { sessionId: api.sessionId, name: api.displayName, status: 'not-attempted', code: 'pin-expired', text: 'Not attempted: the PIN access token expired. Enter the PIN again and retry the remaining sessions.' },
    ];
    const { calls } = stubFetch({ ...CSRF, ...rulesRoutes(), [ADD]: { body: { ok: true, requestId: 'r', category: 'rm', mode: 'once', replayed: false, results: answer, counts: { granted: 1, refused: 1, failed: 0, 'not-attempted': 1 } } } });
    render(<BatchAddBypassDialog rows={rows} onClose={vi.fn()} />);
    const dialog = await screen.findByRole('dialog');
    await fillAndSubmit(dialog);
    const summary = await screen.findByText('1 granted, 1 refused, 1 not attempted');
    expect(summary).toBeInTheDocument();
    const body = post(calls, '/guardrails/batch/grants')?.body as { requestId: string; category: string; mode: string; rationale: string; sessions: string[] };
    expect(body).toMatchObject({ category: 'rm', mode: 'once', rationale: 'clean the build folders', sessions: [shopA.sessionId, shopB.sessionId, api.sessionId] });
    expect(body.requestId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    const list = screen.getByRole('list', { name: 'Results' });
    expect(within(list).getAllByRole('listitem').map((item) => item.getAttribute('data-result-status'))).toEqual(['granted', 'refused', 'not-attempted']);
    expect(within(list).getByText(/cannot be bypassed: it is hardcoded/)).toBeInTheDocument();
    expect(within(list).getByText(/Enter the PIN again and retry/)).toBeInTheDocument();
  });

  it('Retry the rest sends only the not-attempted sessions with a NEW requestId, once per click, and merges the answer; nothing retries by itself', async () => {
    const first: BatchGrantResult[] = [
      granted(shopA, 'c0ffee01'),
      { sessionId: shopB.sessionId, name: shopB.displayName, status: 'not-attempted', code: 'pin-expired', text: 'Not attempted: expired. Enter the PIN again and retry the remaining sessions.' },
      { sessionId: api.sessionId, name: api.displayName, status: 'not-attempted', code: 'pin-expired', text: 'Not attempted: expired. Enter the PIN again and retry the remaining sessions.' },
    ];
    let count = 0;
    const { calls } = stubFetch({
      ...CSRF,
      ...rulesRoutes(),
      [ADD]: (call) => {
        count += 1;
        const sent = (call.body as { sessions: string[] }).sessions;
        const results = count === 1 ? first : sent.map((id) => granted(id === shopB.sessionId ? shopB : api, `c0ffee0${count}`));
        return { body: { ok: true, requestId: 'r', category: 'rm', mode: 'once', replayed: false, results, counts: { granted: results.length, refused: 0, failed: 0, 'not-attempted': 0 } } };
      },
    });
    render(<BatchAddBypassDialog rows={rows} onClose={vi.fn()} />);
    const dialog = await screen.findByRole('dialog');
    await fillAndSubmit(dialog);
    await screen.findByText('1 granted, 2 not attempted');
    // No automatic retry.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls.filter((call) => call.method === 'POST' && call.path === '/guardrails/batch/grants')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry the 2 not attempted' }));
    await screen.findByText('3 granted');
    const posts = calls.filter((call) => call.method === 'POST' && call.path === '/guardrails/batch/grants').map((call) => call.body as { requestId: string; sessions: string[]; rationale: string });
    expect(posts).toHaveLength(2);
    expect(posts[1]?.sessions).toEqual([shopB.sessionId, api.sessionId]);
    expect(posts[1]?.requestId).not.toBe(posts[0]?.requestId);
    expect(posts[1]?.rationale).toBe('clean the build folders');
    expect(screen.queryByRole('button', { name: /Retry the/ })).toBeNull();
  });

  it('a refusal of the whole request (no PIN, 409) is an alert, the dialog stays, the SAME requestId is used by the next click', async () => {
    let count = 0;
    const { calls } = stubFetch({
      ...CSRF,
      ...rulesRoutes(),
      [ADD]: () => {
        count += 1;
        return count === 1 ? { status: 409, body: { ok: false, error: { code: 'request-id-reused', message: 'The requestId was already used', hint: 'Send a new one.' } } } : { body: { ok: true, requestId: 'r', category: 'rm', mode: 'once', replayed: true, results: [granted(shopA, 'c0ffee01')], counts: { granted: 1, refused: 0, failed: 0, 'not-attempted': 0 } } };
      },
    });
    render(<BatchAddBypassDialog rows={rows} onClose={vi.fn()} />);
    const dialog = await screen.findByRole('dialog');
    await fillAndSubmit(dialog);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The requestId was already used. Send a new one.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add bypass' }));
    await screen.findByText('1 granted');
    const ids = calls.filter((call) => call.method === 'POST' && call.path === '/guardrails/batch/grants').map((call) => (call.body as { requestId: string }).requestId);
    expect(ids[0]).toBe(ids[1]);
  });

  it('more than 20 sessions: the button is off and says to untick', async () => {
    const many = Array.from({ length: 21 }, (_, index) => row({ displayName: `agent-${index}`, cwd: '/w/shop' }));
    stubFetch({ ...CSRF, [RULES(many[0]?.sessionId ?? '')]: { body: rulesOf('x', '/w/shop', [rule('rm')]) } });
    render(<BatchAddBypassDialog rows={many} onClose={vi.fn()} />);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/at most 20 sessions.*untick 1/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add bypass' })).toBeDisabled();
  });

  it('Escape closes it', async () => {
    const onClose = vi.fn();
    stubFetch({ ...CSRF, ...rulesRoutes() });
    render(<BatchAddBypassDialog rows={rows} onClose={onClose} />);
    await screen.findByRole('dialog');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

const cliGrant = (sessionId: string, id: string, category: string, over: Partial<CliGrantDto> = {}): CliGrantDto => ({ id, category, mode: 'ttl', sessionId, expiresAt: Date.now() + 600_000, remainingMs: 600_000, remainingText: '10 min', usesLeft: null, reason: 'x', origin: 'ui', ...over });
const grantsOf = (target: typeof shopA, grants: CliGrantDto[]): SessionGrantsDto => ({ ok: true, code: '', sessionId: target.sessionId, cwd: target.cwd, cwdNote: '', grants, errorText: '' });

function grantsRoutes(): Record<string, FakeAnswer> {
  return {
    [GRANTS(shopA.sessionId)]: { body: grantsOf(shopA, [cliGrant(shopA.sessionId, 'aaaaaaa1', 'rm'), cliGrant(shopA.sessionId, 'aaaaaaa2', 'git-push')]) },
    [GRANTS(shopB.sessionId)]: { body: grantsOf(shopB, [cliGrant(shopB.sessionId, 'bbbbbbb1', 'rm')]) },
    [GRANTS(api.sessionId)]: { body: grantsOf(api, []) },
  };
}

describe('BatchRemoveBypassDialog', () => {
  it('reads the bypasses of every selected session, then lists them grouped by category with counts, nothing ticked, the button off', async () => {
    const { calls } = stubFetch({ ...CSRF, ...grantsRoutes() });
    render(<BatchRemoveBypassDialog rows={rows} onClose={vi.fn()} />);
    const dialog = await screen.findByRole('dialog', { name: 'Remove bypasses from 3 sessions' });
    await within(dialog).findByRole('group', { name: 'rm' });
    expect(calls.filter((call) => call.path.endsWith('/grants') && call.method === 'GET')).toHaveLength(3);
    const rm = within(dialog).getByRole('group', { name: 'rm' });
    expect(within(rm).getByText('2 bypasses')).toBeInTheDocument();
    expect(within(rm).getByText('shop-owner')).toBeInTheDocument();
    expect(within(rm).getByText('shop-helper')).toBeInTheDocument();
    expect(within(dialog).getByRole('group', { name: 'git-push' })).toBeInTheDocument();
    expect(within(dialog).getByText(/api-owner has no active bypass/)).toBeInTheDocument();
    for (const box of within(dialog).getAllByRole('checkbox')) {
      expect(box).not.toBeChecked();
    }
    expect(within(dialog).getByRole('button', { name: 'Remove bypasses' })).toBeDisabled();
  });

  it('a session whose list cannot be read is said with its reason, never shown as having no bypass', async () => {
    stubFetch({ ...CSRF, ...grantsRoutes(), [GRANTS(api.sessionId)]: { body: { ...grantsOf(api, []), ok: false, code: 'timeout', errorText: 'The plugin did not answer in 10 s.' } } });
    render(<BatchRemoveBypassDialog rows={rows} onClose={vi.fn()} />);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/api-owner.*The plugin did not answer in 10 s/);
  });

  it('ticking a category ticks its bypasses; the confirm line counts what is ticked; the request names session and grant ids', async () => {
    const answer: BatchRevokeResult[] = [
      { sessionId: shopA.sessionId, name: 'shop-owner', grantId: 'aaaaaaa1', category: 'rm', status: 'revoked', code: '', text: 'Revoked rm' },
      { sessionId: shopB.sessionId, name: 'shop-helper', grantId: 'bbbbbbb1', category: '', status: 'refused', code: 'grant-not-found', text: 'No active bypass bbbbbbb1 for session x. It may have been used up.' },
    ];
    const { calls } = stubFetch({ ...CSRF, ...grantsRoutes(), [REVOKE]: { body: { ok: true, requestId: 'r', replayed: false, results: answer, counts: { revoked: 1, refused: 1, failed: 0 } } } });
    render(<BatchRemoveBypassDialog rows={rows} onClose={vi.fn()} />);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('group', { name: 'rm' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Select all rm bypasses' }));
    expect(within(dialog).getByText('Remove 2 bypasses (rm 2) from 2 sessions')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove 2 bypasses' }));
    await screen.findByText('1 revoked, 1 refused');
    expect(post(calls, '/guardrails/batch/revoke')?.body).toMatchObject({
      items: [
        { sessionId: shopA.sessionId, grantId: 'aaaaaaa1' },
        { sessionId: shopB.sessionId, grantId: 'bbbbbbb1' },
      ],
    });
    const list = screen.getByRole('list', { name: 'Results' });
    expect(within(list).getAllByRole('listitem').map((item) => item.getAttribute('data-result-status'))).toEqual(['revoked', 'refused']);
    expect(within(list).getByText(/It may have been used up/)).toBeInTheDocument();
  });

  it('one bypass can be unticked inside a ticked category', async () => {
    const { calls } = stubFetch({ ...CSRF, ...grantsRoutes(), [REVOKE]: { body: { ok: true, requestId: 'r', replayed: false, results: [], counts: { revoked: 0, refused: 0, failed: 0 } } } });
    render(<BatchRemoveBypassDialog rows={rows} onClose={vi.fn()} />);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('group', { name: 'rm' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Select all rm bypasses' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Remove rm of shop-helper' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove 1 bypass' }));
    await waitFor(() => expect(post(calls, '/guardrails/batch/revoke')).toBeDefined());
    expect((post(calls, '/guardrails/batch/revoke')?.body as { items: unknown[] }).items).toEqual([{ sessionId: shopA.sessionId, grantId: 'aaaaaaa1' }]);
  });

  it('a refusal of the whole request is an alert and the dialog stays; Escape closes', async () => {
    const onClose = vi.fn();
    stubFetch({ ...CSRF, ...grantsRoutes(), [REVOKE]: { status: 409, body: { ok: false, error: { code: 'duplicate-request', message: 'The request is still running', hint: 'Wait for its answer.' } } } });
    render(<BatchRemoveBypassDialog rows={rows} onClose={onClose} />);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('group', { name: 'rm' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Select all rm bypasses' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove 2 bypasses' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The request is still running. Wait for its answer.');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
