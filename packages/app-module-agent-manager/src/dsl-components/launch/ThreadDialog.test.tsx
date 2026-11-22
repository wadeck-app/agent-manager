import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ownedDto, ownedRow, row } from '../logic/fixtures.js';
import { shortMessage } from '../logic/threadForm.js';
import { stubFetch } from '../owned/testFetch.js';
import { DaemonStateProvider } from '../owned/DaemonState.js';
import { ThreadDialog } from './ThreadDialog.js';

afterEach(() => vi.unstubAllGlobals());

const SOURCE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const THREAD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ANCHOR = '27bf9648-39df-453b-bd04-99816f5c1819';
const MESSAGE = 'why is the build red on the second run of the pipeline when nothing changed?';

function open(session: Parameters<typeof ThreadDialog>[0]['session']) {
  const onClose = vi.fn();
  const onStarted = vi.fn();
  render(<ThreadDialog session={session} anchor={{ uuid: ANCHOR, text: MESSAGE }} onClose={onClose} onStarted={onStarted} />);
  return { onClose, onStarted };
}

const startButton = (): HTMLElement => screen.getByRole('button', { name: 'Start thread' });

describe('Thread dialog: the daemon is not running', () => {
  it('disables Start thread, says why with the fix command, and never posts', () => {
    const { calls } = stubFetch({});
    render(
      <DaemonStateProvider down>
        <ThreadDialog session={row({ sessionId: SOURCE, displayName: 'shop' })} anchor={{ uuid: ANCHOR, text: MESSAGE }} onClose={vi.fn()} onStarted={vi.fn()} />
      </DaemonStateProvider>,
    );
    expect(startButton()).toBeDisabled();
    expect(screen.getByText(/daemon is not running, so you cannot start a thread/)).toBeInTheDocument();
    expect(screen.getByText('agent-manager start --detach')).toBeInTheDocument();
    expect(calls.some((call) => call.path === '/owned/fork')).toBe(false);
  });
});

describe('Thread dialog', () => {
  it('names the source, quotes the message, defaults the name to "thread: <first 40 characters>" and says what a thread is', () => {
    stubFetch({});
    open(row({ sessionId: SOURCE, displayName: 'shop' }));
    expect(screen.getByRole('dialog', { name: 'Thread on shop' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue(`thread: ${MESSAGE.slice(0, 40).trim()}`);
    expect(screen.getByText(/knows the conversation only up to and including this message/)).toBeInTheDocument();
    expect(screen.getByText(/why is the build red/, { selector: 'blockquote' })).toBeInTheDocument();
    expect(screen.getByText(/same files/)).toBeInTheDocument();
  });

  it('posts the anchor with the name; a discovered source leaves model and mode to Claude Code, and the thread is reported and its quote remembered', async () => {
    const { calls } = stubFetch({ 'POST /owned/fork': { body: { ok: true, session: ownedDto({ id: THREAD, forkedFrom: SOURCE, forkedAtMessage: ANCHOR }) } } });
    const { onStarted, onClose } = open(row({ sessionId: SOURCE, displayName: 'shop' }));
    expect(screen.getByLabelText('Model')).toHaveValue('');
    await userEvent.click(startButton());
    await waitFor(() => expect(onStarted).toHaveBeenCalledTimes(1));
    expect(onStarted.mock.calls[0]?.[0]).toMatchObject({ id: THREAD, forkedAtMessage: ANCHOR });
    expect(onClose).toHaveBeenCalled();
    expect(calls.find((call) => call.path === '/owned/fork')?.body).toEqual({ sourceSessionId: SOURCE, atMessageId: ANCHOR, atMessageQuote: shortMessage(MESSAGE), name: `thread: ${MESSAGE.slice(0, 40).trim()}` });
  });

  it('an owned source gives its model and mode, shown as inherited and waited for before the button works; the body carries them', async () => {
    const { calls } = stubFetch({
      'GET /owned': { body: { ok: true, generatedAt: 'now', daemon: {}, sessions: [ownedDto({ id: SOURCE, model: 'haiku', permissionMode: 'plan' })] } },
      'POST /owned/fork': { body: { ok: true, session: ownedDto({ id: THREAD }) } },
    });
    open(ownedRow({ sessionId: SOURCE, displayName: 'x1' }));
    await waitFor(() => expect(screen.getByLabelText('Model')).toHaveValue('haiku'));
    expect(screen.getByLabelText('Permission mode')).toHaveValue('plan');
    expect(screen.getByText(/The model this session was launched with/)).toBeInTheDocument();
    await userEvent.click(startButton());
    await waitFor(() => expect(calls.some((call) => call.path === '/owned/fork')).toBe(true));
    expect(calls.find((call) => call.path === '/owned/fork')?.body).toMatchObject({ model: 'haiku', permissionMode: 'plan', atMessageId: ANCHOR });
  });

  it('keeps the dialog open and shows the cap refusal with its fix (a fourth live thread), never a silent close', async () => {
    stubFetch({ 'POST /owned/fork': { status: 409, body: { ok: false, error: { code: 'too-many-threads', message: '3 threads of the session are live', hint: 'stop one of its threads, then retry' } } } });
    const { onStarted, onClose } = open(row({ sessionId: SOURCE }));
    await userEvent.click(startButton());
    expect(await screen.findByText(/stop one of its threads, then retry/)).toBeInTheDocument();
    expect(onStarted).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(startButton()).toBeEnabled();
  });

  it('shows the refusal of an unknown anchor with its fix', async () => {
    stubFetch({ 'POST /owned/fork': { status: 404, body: { ok: false, error: { code: 'fork-anchor-not-found', message: 'the message is not in the transcript', hint: 'reload the log and pick a shown message' } } } });
    open(row({ sessionId: SOURCE }));
    await userEvent.click(startButton());
    expect(await screen.findByText(/reload the log and pick a shown message/)).toBeInTheDocument();
  });

  it('refuses a name above the limit before sending anything', async () => {
    const { calls } = stubFetch({});
    open(row({ sessionId: SOURCE }));
    const name = screen.getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'x'.repeat(70));
    expect(screen.getByRole('alert')).toHaveTextContent(/limit is 64/);
    expect(startButton()).toBeDisabled();
    expect(calls.some((call) => call.path === '/owned/fork')).toBe(false);
  });
});
