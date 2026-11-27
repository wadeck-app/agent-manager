import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { row } from '../logic/fixtures.js';
import type { HcPermissionPromptDto } from '../shared.js';
import { HcPermissionCard, wantsHcCard } from './HcPermissionCard.js';
import { stubFetch, type Call } from './testFetch.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const ID = '22222222-2222-4222-8222-222222222222';
const waitingRow = (over: Parameters<typeof row>[0] = {}) => row({ sessionId: ID, state: 'needs-you', status: 'waiting', ...over });
const prompt = (patch: Partial<HcPermissionPromptDto> = {}): HcPermissionPromptDto => ({
  promptId: '0123456789abcdef',
  terminal: 't21',
  tool: 'Bash',
  header: 'Bash command',
  description: 'Create am-allow.txt file',
  body: 'touch am-allow.txt',
  notice: '',
  question: 'Do you want to proceed?',
  options: [
    { number: 1, label: 'Yes' },
    { number: 2, label: 'Yes, and always allow access to C:\\proj from this project' },
    { number: 3, label: 'No' },
  ],
  statusMessage: 'approve Bash: touch am-allow.txt',
  ...patch,
});
const shown = (patch: Partial<HcPermissionPromptDto> = {}) => ({ body: { ok: true, sessionId: ID, state: 'prompt', prompt: prompt(patch) } });
const GET = `GET /sessions/${ID}/hc-permission`;
const POST = `POST /sessions/${ID}/hc-permission`;
const decided = (decision: 'allow' | 'deny', over: Record<string, unknown> = {}) => ({
  body: { ok: true, sessionId: ID, decision, promptId: '0123456789abcdef', terminal: 't21', keys: [decision === 'allow' ? 'enter' : 'esc'], tool: 'Bash', effect: 'closed', statusAfter: 'working', ...over },
});

describe('wantsHcCard', () => {
  it('is for a live waiting session that is not a Web session', () => {
    expect(wantsHcCard(waitingRow())).toBe(true);
    expect(wantsHcCard(waitingRow({ launchedBy: 'agent-manager', host: 'hc' }))).toBe(true);
    expect(wantsHcCard(waitingRow({ launchedBy: 'agent-manager', host: 'stream-json' }))).toBe(false);
    expect(wantsHcCard(waitingRow({ state: 'working' }))).toBe(false);
    expect(wantsHcCard(waitingRow({ alive: false }))).toBe(false);
  });
});

describe('HcPermissionCard: what is shown', () => {
  it('shows the command, the terminal and a warning that this types into the terminal; no key answers it', async () => {
    stubFetch({ [GET]: shown() });
    render(<HcPermissionCard session={waitingRow()} />);
    const card = await screen.findByRole('region', { name: 'Permission request in the terminal' });
    expect(card).toHaveTextContent('Permission request: Bash: Bash command');
    expect(card).toHaveTextContent('terminal t21');
    expect(card).toHaveTextContent('Create am-allow.txt file');
    expect(card.querySelector('[data-permission-input] pre')?.textContent).toBe('touch am-allow.txt');
    expect(card.querySelector('[data-hc-warning]')).toHaveTextContent(/answers the dialog in the terminal by typing the key there: Allow once types Enter.*Deny types Esc.*Always allow.*never selected/);
    expect(document.activeElement).toBe(document.body);
    for (const name of ['Allow once', 'Deny']) {
      expect(screen.getByRole('button', { name })).not.toHaveAttribute('accesskey');
    }
    await userEvent.keyboard('{Enter} ya');
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeEnabled();
  });

  it('offers no always-allow button', async () => {
    stubFetch({ [GET]: shown() });
    render(<HcPermissionCard session={waitingRow()} />);
    await screen.findByRole('button', { name: 'Allow once' });
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Deny', 'Allow once']);
  });

  it('folds a large command behind a visible button and keeps the whole text', async () => {
    const big = Array.from({ length: 40 }, (_, index) => `line ${index} of a long script`).join('\n');
    stubFetch({ [GET]: shown({ body: big }) });
    render(<HcPermissionCard session={waitingRow()} />);
    await screen.findByRole('button', { name: /Show all \(40 lines/ });
    expect((document.querySelector('[data-permission-input] pre') as HTMLElement).textContent).toBe(big);
  });

  it('shows the whole command, including lines that look like frame rules', async () => {
    const rule = String.fromCodePoint(0x254c).repeat(20);
    const command = `echo shown
${rule}
echo after-the-rule`;
    stubFetch({ [GET]: shown({ body: command }) });
    render(<HcPermissionCard session={waitingRow()} />);
    await screen.findByRole('button', { name: 'Allow once' });
    expect(document.querySelector('[data-permission-input] pre')?.textContent).toBe(command);
  });

  it('a dialog too long to show whole is a warning with the fix, no buttons', async () => {
    stubFetch({ [GET]: { body: { ok: true, sessionId: ID, state: 'unsupported', terminal: 't21', code: 'dialog-too-long', reason: 'the dialog of t21 shows 30000 characters, more than the 20000 this page shows whole', fix: 'read and answer it in its terminal' } } });
    render(<HcPermissionCard session={waitingRow()} />);
    expect(await screen.findByRole('status')).toHaveTextContent(/more than the 20000 this page shows whole. read and answer it in its terminal/i);
    expect(screen.queryByRole('button', { name: 'Allow once' })).toBeNull();
  });

  it('renders nothing, and does not ask, for a session that does not wait', async () => {
    const { calls } = stubFetch({});
    const { container } = render(<HcPermissionCard session={waitingRow({ state: 'working' })} />);
    expect(container).toBeEmptyDOMElement();
    expect(calls).toHaveLength(0);
  });

  it('renders nothing when the terminal is not blocked (the row lags)', async () => {
    const { calls } = stubFetch({ [GET]: { body: { ok: true, sessionId: ID, state: 'none', terminal: 't21', status: 'working' } } });
    const { container } = render(<HcPermissionCard session={waitingRow()} />);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(container).toBeEmptyDOMElement();
  });
});

describe('HcPermissionCard: refusals say why', () => {
  it('a session that was not started in a herdr-core terminal says so, with the fix', async () => {
    stubFetch({ [GET]: { body: { ok: false, error: { code: 'no-terminal', message: 'no herdr-core terminal runs the session process (pid 7): the session was not started in a herdr-core terminal', hint: 'start the session with `hc run --bg claude`' } } } });
    render(<HcPermissionCard session={waitingRow()} />);
    const note = await screen.findByRole('status');
    expect(note).toHaveTextContent(/cannot be answered from this page: no herdr-core terminal runs the session process.*started in a herdr-core terminal.*hc run --bg claude/);
    expect(screen.queryByRole('button', { name: 'Allow once' })).toBeNull();
  });

  it('hc missing is told with the install fix', async () => {
    stubFetch({ [GET]: { body: { ok: false, error: { code: 'hc-missing', message: "the program 'hc' was not found (get t1)", hint: 'install herdr-core and put `hc` on the PATH' } } } });
    render(<HcPermissionCard session={waitingRow()} />);
    expect(await screen.findByRole('status')).toHaveTextContent(/hc was not found|'hc' was not found.*PATH/);
  });

  it('a dialog that is not a tool permission (trust, question) is shown as a warning with the fix, no buttons', async () => {
    stubFetch({ [GET]: { body: { ok: true, sessionId: ID, state: 'unsupported', terminal: 't21', code: 'dialog-not-recognized', reason: 'the terminal t21 is blocked on a permission dialog this module cannot answer safely', fix: 'answer it in its terminal' } } });
    render(<HcPermissionCard session={waitingRow()} />);
    expect(await screen.findByRole('status')).toHaveTextContent(/cannot answer safely\. answer it in its terminal/i);
    expect(screen.queryByRole('button', { name: 'Allow once' })).toBeNull();
  });

  it('a request that fails (server unreachable) is an alert', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('network down'))),
    );
    render(<HcPermissionCard session={waitingRow()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot be answered from this page: Cannot reach the app-core server/);
  });
});

describe('HcPermissionCard: answering', () => {
  it('Allow once posts allow with the prompt id, says which key was typed, and hides the dialog', async () => {
    let waiting = true;
    const { calls } = stubFetch({
      [GET]: () => (waiting ? shown() : { body: { ok: true, sessionId: ID, state: 'none', terminal: 't21', status: 'working' } }),
      [POST]: () => {
        waiting = false;
        return decided('allow');
      },
    });
    render(<HcPermissionCard session={waitingRow()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Allow once' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Allowed Bash once (enter was typed into t21). The terminal is now working.');
    const post = calls.find((call) => call.method === 'POST') as Call;
    expect(post.body).toEqual({ decision: 'allow', promptId: '0123456789abcdef' });
    expect(post.headers['X-Agent-Manager-Csrf']).toBe('test-token');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Allow once' })).toBeNull());
  });

  it('Deny posts deny and says esc was typed', async () => {
    const { calls } = stubFetch({ [GET]: shown(), [POST]: decided('deny') });
    render(<HcPermissionCard session={waitingRow()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Deny' }));
    expect(await screen.findByText('Denied Bash (esc was typed into t21). The terminal is now working.')).toBeInTheDocument();
    expect((calls.find((call) => call.method === 'POST') as Call).body).toEqual({ decision: 'deny', promptId: '0123456789abcdef' });
  });

  it('the dialog still displayed after the key is a warning to look at the terminal', async () => {
    stubFetch({ [GET]: shown(), [POST]: decided('allow', { effect: 'unchanged', statusAfter: 'blocked' }) });
    render(<HcPermissionCard session={waitingRow()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Allow once' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/enter was typed into t21, but the dialog is still displayed after a few seconds\. Look at the terminal t21/i);
  });

  it('shows the text the dialog prints between the command and its question, as its own block labelled as such', async () => {
    stubFetch({ [GET]: shown({ notice: 'HOOK REQUEST for THIS agent\n  Category  git-commit-push' }) });
    render(<HcPermissionCard session={waitingRow()} />);
    const card = await screen.findByRole('region', { name: 'Permission request in the terminal' });
    const notice = card.querySelector('[data-hc-notice]');
    expect(notice).toHaveTextContent('Shown by the terminal below the command');
    expect(notice?.querySelector('pre')?.textContent).toBe('HOOK REQUEST for THIS agent\n  Category  git-commit-push');
    expect(card.querySelector('[data-permission-input] pre')?.textContent).toBe('touch am-allow.txt');
  });

  it('shows no notice block when the dialog has none', async () => {
    stubFetch({ [GET]: shown() });
    render(<HcPermissionCard session={waitingRow()} />);
    await screen.findByRole('region', { name: 'Permission request in the terminal' });
    expect(document.querySelector('[data-hc-notice]')).toBeNull();
  });

  it('an answer whose outcome could not be checked says the key was sent and to look at the terminal, never "nothing was typed"', async () => {
    stubFetch({ [GET]: shown(), [POST]: decided('allow', { effect: 'unknown', statusAfter: 'unknown', note: 'the key was sent, check the terminal t21 (it could not be read afterwards: hc is busy)' }) });
    render(<HcPermissionCard session={waitingRow()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Allow once' }));
    const note = await screen.findByRole('status');
    expect(note).toHaveTextContent(/enter was typed into t21, or may have been: the key was sent, check the terminal t21/i);
    expect(note).not.toHaveTextContent(/nothing was typed/);
  });

  it('prompt-changed: nothing was typed, the error says so, and the new dialog replaces the old one', async () => {
    let current = prompt();
    const { calls } = stubFetch({
      [GET]: () => ({ body: { ok: true, sessionId: ID, state: 'prompt', prompt: current } }),
      [POST]: () => {
        current = prompt({ promptId: 'fedcba9876543210', body: 'rm -rf build', description: 'Remove the build folder' });
        return { status: 409, body: { ok: false, error: { code: 'prompt-changed', message: 'the dialog of t21 is not the one that was shown', hint: 'nothing was typed; read the dialog again and decide on what it shows now' } } };
      },
    });
    render(<HcPermissionCard session={waitingRow()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Allow once' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/was not allowed from this page\. the dialog of t21 is not the one that was shown.*read the dialog again/i);
    await waitFor(() => expect(document.querySelector('[data-permission-input] pre')?.textContent).toBe('rm -rf build'));
    expect(document.querySelector('[data-hc-permission]')?.getAttribute('data-hc-permission')).toBe('fedcba9876543210');
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('a failure of hc is shown with its fix', async () => {
    stubFetch({ [GET]: shown(), [POST]: { status: 502, body: { ok: false, error: { code: 'hc-keys-failed', message: 'hc keys refused (invalid): bad key', hint: 'look at the terminal (hc read), answer it there if needed' } } } });
    render(<HcPermissionCard session={waitingRow()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Deny' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/was not denied from this page\. hc keys refused \(invalid\): bad key.*look at the terminal/i);
    // The dialog stays: the user can try again or answer in the terminal.
    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
  });

  it('disables both buttons while a decision is in flight', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    stubFetch({
      [GET]: shown(),
      [POST]: async () => {
        await gate;
        return decided('allow');
      },
    });
    render(<HcPermissionCard session={waitingRow()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Allow once' }));
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
    release();
    await screen.findByRole('status');
  });
});
