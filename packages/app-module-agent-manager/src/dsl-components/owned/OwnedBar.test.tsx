import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ownedDto, ownedRow } from '../logic/fixtures.js';
import type { OwnedSessionDto } from '../shared.js';
import { OwnedBar, RESUME_TEXT } from './OwnedBar.js';
import { stubFetch } from './testFetch.js';

afterEach(() => vi.unstubAllGlobals());

const ID = '11111111-1111-4111-8111-111111111111';
const listed = (...sessions: OwnedSessionDto[]) => ({ body: { ok: true, generatedAt: 'now', daemon: {}, sessions } });

function bar(row = ownedRow({ sessionId: ID })) {
  const onChange = vi.fn();
  const onForgotten = vi.fn();
  render(<OwnedBar session={row} onChange={onChange} onForgotten={onForgotten} />);
  return { onChange, onForgotten };
}

describe('OwnedBar: a discovered session', () => {
  it('renders nothing and asks nothing', () => {
    const { calls } = stubFetch({});
    const { container } = render(<OwnedBar session={ownedRow({ launchedBy: 'discovered', host: null, ownedState: undefined })} onChange={vi.fn()} onForgotten={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    expect(calls).toHaveLength(0);
  });
});

describe('OwnedBar: a live Web session', () => {
  it('shows its host, offers Stop and the permission mode, and no Resume or Forget', async () => {
    stubFetch({ 'GET /owned': listed(ownedDto({ id: ID, permissionMode: 'acceptEdits', model: 'haiku' })) });
    bar();
    expect(document.querySelector('[data-host-badge="stream-json"]')).toHaveTextContent('Web');
    const mode = await screen.findByLabelText('Permission mode');
    await waitFor(() => expect(mode).toHaveValue('acceptEdits'));
    expect(screen.getByRole('button', { name: /Stop/ })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Resume/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Forget' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Interrupt' })).toBeNull();
  });

  it('Interrupt is offered while a turn runs and posts to the owned route', async () => {
    const { calls } = stubFetch({ 'GET /owned': listed(ownedDto({ id: ID, state: 'running' })), [`POST /owned/${ID}/interrupt`]: { body: { ok: true, sessionId: ID, stillQueued: [], cancelled: [] } } });
    bar(ownedRow({ sessionId: ID, ownedState: 'running' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Interrupt' }));
    expect(await screen.findByText('The running turn was interrupted.')).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'POST')?.headers['X-Agent-Manager-Csrf']).toBe('test-token');
  });

  it('Stop asks first, says what ends, then posts and reports the state the daemon returned', async () => {
    const exited = ownedDto({ id: ID, status: 'exited', state: 'exited' });
    const { calls } = stubFetch({ 'GET /owned': listed(ownedDto({ id: ID })), [`POST /owned/${ID}/stop`]: { body: { ok: true, session: exited } } });
    const { onChange } = bar();
    await userEvent.click(await screen.findByRole('button', { name: /Stop/ }));
    const dialog = screen.getByRole('dialog', { name: 'Stop this session?' });
    expect(dialog).toHaveTextContent('The session ends');
    // Nothing was sent by opening the dialog, and the focus starts on Cancel.
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Stop the session' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ kind: 'updated', session: exited }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a refused Stop stays in the dialog with the daemon text', async () => {
    stubFetch({ 'GET /owned': listed(ownedDto({ id: ID })), [`POST /owned/${ID}/stop`]: { status: 409, body: { ok: false, error: { code: 'session-not-live', message: 'The session is not live', hint: 'Reload the page' } } } });
    const { onChange } = bar();
    await userEvent.click(await screen.findByRole('button', { name: /Stop/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Stop the session' }));
    expect(await screen.findByText('The session is not live. Reload the page')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('changes the permission mode through the owned route and says so', async () => {
    const { calls } = stubFetch({ 'GET /owned': listed(ownedDto({ id: ID, permissionMode: 'default' })), [`POST /owned/${ID}/permission-mode`]: { body: { ok: true, sessionId: ID, mode: 'plan' } } });
    bar();
    const mode = await screen.findByLabelText('Permission mode');
    await waitFor(() => expect(mode).toHaveValue('default'));
    await userEvent.selectOptions(mode, 'plan');
    expect(await screen.findByText('The permission mode is now plan.')).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'POST')).toMatchObject({ path: `/owned/${ID}/permission-mode`, body: { mode: 'plan' } });
  });

  it('a mode the list does not know is shown as it is, never replaced', async () => {
    stubFetch({ 'GET /owned': listed(ownedDto({ id: ID, permissionMode: 'bypassPermissions' })) });
    bar();
    const mode = await screen.findByLabelText('Permission mode');
    await waitFor(() => expect(mode).toHaveValue('bypassPermissions'));
  });
});

describe('OwnedBar: an interrupted session', () => {
  const interrupted = () => ownedRow({ sessionId: ID, ownedState: 'interrupted', alive: false, state: 'ended' });

  it('says honestly what Resume restores and what it does not, and Resume posts then reports the new state', async () => {
    const resumed = ownedDto({ id: ID, state: 'idle', status: 'live' });
    const { calls } = stubFetch({
      'GET /owned': listed(ownedDto({ id: ID, status: 'interrupted', state: 'interrupted', resumable: true })),
      [`POST /owned/${ID}/resume`]: { body: { ok: true, session: resumed } },
    });
    const { onChange } = bar(interrupted());
    expect(screen.getByText(/the daemon that ran it ended while it was live/)).toBeInTheDocument();
    expect(screen.getByText(RESUME_TEXT)).toHaveTextContent('NOT replayed');
    expect(document.querySelector('[data-owned-state="interrupted"]')).toHaveTextContent('Interrupted');
    await userEvent.click(await screen.findByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ kind: 'updated', session: resumed }));
    // The shell fetcher sends {} for a write without a body; the point is that no acknowledgeLeftover goes along.
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({});
    expect(await screen.findByText(/Send your message again if the lost turn still matters/)).toBeInTheDocument();
  });

  it('with a leftover claude process, Resume becomes Resume anyway behind a confirmation that names the pid, and sends the acknowledgement', async () => {
    const { calls } = stubFetch({
      'GET /owned': listed(ownedDto({ id: ID, status: 'interrupted', state: 'interrupted', resumable: true, leftoverPid: 4242 })),
      [`POST /owned/${ID}/resume`]: { body: { ok: true, session: ownedDto({ id: ID }) } },
    });
    bar(interrupted());
    await userEvent.click(await screen.findByRole('button', { name: 'Resume anyway' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('pid 4242');
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Resume anyway' }));
    await waitFor(() => expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ acknowledgeLeftover: true }));
  });

  it('a session that cannot be resumed says why (the daemon note) and offers Forget, never a dead Resume', async () => {
    stubFetch({ 'GET /owned': listed(ownedDto({ id: ID, status: 'interrupted', state: 'interrupted', resumable: false, note: 'The transcript of this session is gone.' })) });
    bar(interrupted());
    expect(await screen.findByText('The transcript of this session is gone.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Resume/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Forget' })).toBeEnabled();
  });

  it('Forget asks first, then posts and tells the page to leave the session', async () => {
    const { calls } = stubFetch({ 'GET /owned': listed(ownedDto({ id: ID, status: 'interrupted', state: 'interrupted', resumable: true })), [`POST /owned/${ID}/forget`]: { body: { ok: true, id: ID } } });
    const { onChange, onForgotten } = bar(interrupted());
    await userEvent.click(await screen.findByRole('button', { name: 'Forget' }));
    expect(screen.getByRole('dialog', { name: 'Forget this session?' })).toHaveTextContent('transcript file of Claude Code stays on disk');
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Forget it' }));
    await waitFor(() => expect(onForgotten).toHaveBeenCalled());
    expect(onChange).toHaveBeenCalledWith({ kind: 'forgotten', id: ID });
  });
});

describe('OwnedBar: an exited session', () => {
  it('shows how the process ended with its stderr', async () => {
    stubFetch({ 'GET /owned': listed(ownedDto({ id: ID, status: 'exited', state: 'exited', resumable: true, exit: { cause: 'crashed', code: 1, signal: null, by: 'self', stderrTail: 'Error: out of memory', at: 5 } })) });
    bar(ownedRow({ sessionId: ID, ownedState: 'exited', alive: false, state: 'ended' }));
    expect(await screen.findByText(/The claude process ended \(crashed, exit code 1\)/)).toBeInTheDocument();
    expect(screen.getByText('Error: out of memory')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument();
  });
});

describe('OwnedBar: a Terminal session', () => {
  it('shows the host and no daemon actions (the terminal is not ours to stop), and does not ask the daemon', () => {
    const { calls } = stubFetch({});
    bar(ownedRow({ sessionId: ID, host: 'hc', ownedState: 'unobserved' }));
    expect(document.querySelector('[data-host-badge="hc"]')).toHaveTextContent('Terminal');
    expect(screen.queryByRole('button')).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
