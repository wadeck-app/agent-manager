import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ownedDto, ownedRow, row } from '../logic/fixtures.js';
import { stubFetch } from '../owned/testFetch.js';
import { DaemonStateProvider } from '../owned/DaemonState.js';
import { ForkDialog } from './ForkDialog.js';

afterEach(() => vi.unstubAllGlobals());

const SOURCE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FORK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function open(session: Parameters<typeof ForkDialog>[0]['session']) {
  const onClose = vi.fn();
  const onForked = vi.fn();
  render(<ForkDialog session={session} onClose={onClose} onForked={onForked} />);
  return { onClose, onForked };
}

const forkButton = (): HTMLElement => screen.getByRole('button', { name: 'Fork' });

/** Opens the folded "Model and mode" options (their closed summary is the button). */
async function openOptions(summary = 'Model and mode: Claude Code default'): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: summary }));
}

describe('Fork dialog: the daemon is not running', () => {
  it('disables Fork, says why with the fix command, and never posts', () => {
    const { calls } = stubFetch({});
    render(
      <DaemonStateProvider down>
        <ForkDialog session={row({ sessionId: SOURCE, displayName: 'shop' })} onClose={vi.fn()} onForked={vi.fn()} />
      </DaemonStateProvider>,
    );
    expect(forkButton()).toBeDisabled();
    expect(screen.getByText(/daemon is not running, so you cannot fork a session/)).toBeInTheDocument();
    expect(screen.getByText('agent-manager start --detach')).toBeInTheDocument();
    expect(calls.some((call) => call.path === '/owned/fork')).toBe(false);
  });
});

describe('Fork dialog: a discovered session', () => {
  it('starts with "fork of <name>", Claude Code deciding model and mode, and posts only what the user chose', async () => {
    const { calls } = stubFetch({ 'POST /owned/fork': { body: { ok: true, session: ownedDto({ id: FORK, forkedFrom: SOURCE, name: 'fork of shop' }) } } });
    const { onForked, onClose } = open(row({ sessionId: SOURCE, displayName: 'shop', model: { id: 'anthropic.claude-haiku-4-5-20251001-v1:0', displayName: 'Haiku 4.5', known: true } }));
    expect(screen.getByLabelText('Name')).toHaveValue('fork of shop');
    // The row shows Haiku 4.5, which is not a value the dialog may send on its own: the family is a tooltip hint, the model stays on the default.
    expect(screen.getByRole('button', { name: 'Model and mode: Claude Code default' })).toBeInTheDocument();
    expect(document.querySelector('[data-model-mode-options]')).toHaveAttribute('title', expect.stringMatching(/shows Haiku 4.5: pick haiku/));
    await openOptions();
    expect(screen.getByLabelText('Model')).toHaveValue('');
    expect(screen.getByLabelText('Permission mode')).toHaveValue('');
    expect(screen.getByText(/continues a copy of this conversation/)).toBeInTheDocument();
    expect(screen.queryByText(/Both agents work on the same files/)).toBeNull();
    await userEvent.click(forkButton());
    await waitFor(() => expect(onForked).toHaveBeenCalledTimes(1));
    expect(onForked.mock.calls[0]?.[0]).toMatchObject({ id: FORK, forkedFrom: SOURCE });
    expect(onClose).toHaveBeenCalled();
    // Nothing the user did not choose is invented: neither the mode nor a model derived from the row.
    expect(calls.find((call) => call.path === '/owned/fork')?.body).toEqual({ sourceSessionId: SOURCE, name: 'fork of shop' });
    // A discovered session has no record to read.
    expect(calls.some((call) => call.path === '/owned')).toBe(false);
  });

  it('sends the model the user picked', async () => {
    const { calls } = stubFetch({ 'POST /owned/fork': { body: { ok: true, session: ownedDto({ id: FORK }) } } });
    open(row({ sessionId: SOURCE, displayName: 'shop' }));
    await openOptions();
    await userEvent.selectOptions(screen.getByLabelText('Model'), 'haiku');
    expect(screen.getByRole('button', { name: 'Model and mode: changed' })).toBeInTheDocument();
    await userEvent.click(forkButton());
    await waitFor(() => expect(calls.some((call) => call.path === '/owned/fork')).toBe(true));
    expect(calls.find((call) => call.path === '/owned/fork')?.body).toEqual({ sourceSessionId: SOURCE, name: 'fork of shop', model: 'haiku' });
  });

  it('cleans a line break out of the default name', () => {
    stubFetch({});
    open(row({ sessionId: SOURCE, displayName: 'two\nlines' }));
    expect(screen.getByLabelText('Name')).toHaveValue('fork of two lines');
  });

  it('warns when the source is working, and says what the fork then contains', () => {
    stubFetch({});
    open(row({ sessionId: SOURCE, state: 'working', status: 'busy' }));
    expect(screen.getByText(/starts from the transcript as written so far/)).toBeInTheDocument();
  });

  it('no warning for an idle source', () => {
    stubFetch({});
    open(row({ sessionId: SOURCE }));
    expect(screen.queryByText(/written so far/)).toBeNull();
  });

  it('keeps the dialog open and shows the refusal with its hint (a source without transcript), never a silent close', async () => {
    stubFetch({ 'POST /owned/fork': { status: 404, body: { ok: false, error: { code: 'fork-source-not-found', message: 'the session to fork has no transcript', hint: 'it cannot be forked until it has a message' } } } });
    const { onForked, onClose } = open(row({ sessionId: SOURCE }));
    await userEvent.click(forkButton());
    expect(await screen.findByText(/it cannot be forked until it has a message/)).toBeInTheDocument();
    expect(onForked).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(forkButton()).toBeEnabled();
  });

  it('refuses a name longer than the daemon accepts, before any request', async () => {
    const { calls } = stubFetch({});
    open(row({ sessionId: SOURCE }));
    const name = screen.getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'x'.repeat(65));
    expect(screen.getByRole('alert')).toHaveTextContent(/limit is 64/);
    expect(forkButton()).toBeDisabled();
    expect(calls).toEqual([]);
  });
});

describe('Fork dialog: an owned session', () => {
  it('keeps Fork off until the record of the session is read, and sends nothing from a guess meanwhile', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { calls } = stubFetch({
      'GET /owned': async () => {
        await gate;
        return { body: { ok: true, generatedAt: 'now', daemon: {}, sessions: [ownedDto({ id: SOURCE, model: 'haiku' })] } };
      },
      'POST /owned/fork': { body: { ok: true, session: ownedDto({ id: FORK }) } },
    });
    open(ownedRow({ sessionId: SOURCE, displayName: 'x1 session', host: 'stream-json', ownedState: 'idle', model: { id: 'anthropic.claude-opus-5', displayName: 'Opus 5', known: true } }));
    expect(forkButton()).toBeDisabled();
    expect(screen.getByText(/Reading the model and permission mode/)).toBeInTheDocument();
    release();
    await waitFor(() => expect(forkButton()).toBeEnabled());
    await openOptions('Model and mode: same as the session');
    expect(screen.getByLabelText('Model')).toHaveValue('haiku');
    await userEvent.click(forkButton());
    await waitFor(() => expect(calls.some((call) => call.path === '/owned/fork')).toBe(true));
    expect(calls.find((call) => call.path === '/owned/fork')?.body).toMatchObject({ model: 'haiku' });
  });

  it('when the record cannot be read Fork stays off and the reason is shown with its hint', async () => {
    const { calls } = stubFetch({ 'GET /owned': { body: { ok: false, error: { code: 'daemon-not-running', message: 'The agent-manager daemon is not running', hint: 'Start it with: agent-manager start --detach' } } } });
    open(ownedRow({ sessionId: SOURCE, host: 'stream-json', ownedState: 'idle' }));
    expect(await screen.findByText(/Fork stays off.*agent-manager start --detach/s)).toBeInTheDocument();
    expect(forkButton()).toBeDisabled();
    expect(calls.some((call) => call.path === '/owned/fork')).toBe(false);
  });

  it('follows the record of the session: the model and the mode it was launched with, until the user chooses', async () => {
    const { calls } = stubFetch({
      'GET /owned': { body: { ok: true, generatedAt: 'now', daemon: {}, sessions: [ownedDto({ id: SOURCE, model: 'sonnet', permissionMode: 'plan' })] } },
      'POST /owned/fork': { body: { ok: true, session: ownedDto({ id: FORK, forkedFrom: SOURCE }) } },
    });
    open(ownedRow({ sessionId: SOURCE, displayName: 'x1 session', host: 'stream-json', ownedState: 'idle' }));
    await openOptions('Model and mode: same as the session');
    expect(screen.getByLabelText('Model')).toHaveValue('sonnet');
    expect(screen.getByLabelText('Permission mode')).toHaveValue('plan');
    await userEvent.selectOptions(screen.getByLabelText('Model'), 'opus');
    await userEvent.click(forkButton());
    await waitFor(() => expect(calls.some((call) => call.path === '/owned/fork')).toBe(true));
    expect(calls.find((call) => call.path === '/owned/fork')?.body).toEqual({ sourceSessionId: SOURCE, name: 'fork of x1 session', model: 'opus', permissionMode: 'plan' });
  });
});
