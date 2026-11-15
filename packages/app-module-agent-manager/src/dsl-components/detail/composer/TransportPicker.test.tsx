import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReplyRequest, ReplyStatusOk } from '../deps.js';
import { row } from '../deps.js';
import { resetPending } from '../pending.js';
import { Composer } from './Composer.js';
import { resetDrafts } from './draftStore.js';
import { statusFixture } from './fixtures.js';

type Put = { url: string; body: unknown; token: string | undefined };
const CSRF_HEADER = 'X-Agent-Manager-Csrf';
let puts: Put[];
let status: ReplyStatusOk;
let putAnswer: () => { status: number; body: unknown };
let replyAnswer: (body: ReplyRequest) => unknown;

const json = (body: unknown, httpStatus = 200): Response => new Response(JSON.stringify(body), { status: httpStatus });

/** socket (peer, available, in use) and hc (typed, not available: a dialog blocks the terminal). */
function twoTransports(patch: Partial<ReplyStatusOk> = {}): ReplyStatusOk {
  const base = statusFixture();
  const socket = base.transports[0]!;
  return {
    ...base,
    transports: [
      { ...socket },
      { transportId: 'hc', description: 'types into the terminal through herdr-core', kind: 'direct', probed: true, available: false, reason: 'a dialog is open in its terminal', fix: 'answer it there first', warnings: [], selected: false, isDefault: false, sessionOverride: false, deliveredAs: 'typed', deliveredAsText: 'typed prompt (as the user)' },
    ],
    ...patch,
  };
}

beforeEach(() => {
  puts = [];
  status = twoTransports();
  putAnswer = () => ({ status: 200, body: { ok: true } });
  replyAnswer = (body) => ({ ok: true, deliveryState: 'sent', deliveryUi: 'delivered', transportId: 'socket', messageId: body.messageId, duplicate: false, auditWarning: '', imagesSaved: 0 });
  resetDrafts();
  resetPending();
  sessionStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const headers = init.headers as Record<string, string> | undefined;
        puts.push({ url, body: JSON.parse(String(init.body)), token: headers?.[CSRF_HEADER] });
        const answer = putAnswer();
        return Promise.resolve(json(answer.body, answer.status));
      }
      if (init?.method === 'POST') {
        return Promise.resolve(json(replyAnswer(JSON.parse(String(init.body)) as ReplyRequest)));
      }
      return Promise.resolve(json(status));
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const session = row({ displayName: 'billing-owner' });

async function openPicker(): Promise<HTMLElement> {
  render(<Composer session={session} />);
  const button = await screen.findByRole('button', { name: 'Transport: socket' });
  fireEvent.click(button);
  return screen.getByRole('dialog', { name: 'Transport' });
}

describe('the transport selector', () => {
  it('lists every transport with how it delivers, availability, and the reason and fix when it is not available', async () => {
    const panel = await openPicker();
    const socket = panel.querySelector('[data-transport="socket"]') as HTMLElement;
    const hc = panel.querySelector('[data-transport="hc"]') as HTMLElement;
    expect(socket).toHaveTextContent('Peer message wrapped by Claude Code');
    expect(socket).toHaveTextContent('Available');
    expect(hc).toHaveTextContent('Typed prompt, as you');
    expect(hc).toHaveTextContent('Not available: a dialog is open in its terminal. answer it there first');
    // An unavailable transport cannot be chosen; the reason is visible instead.
    expect(within(hc).getByRole('button', { name: 'Use for this session' })).toBeDisabled();
    expect(within(hc).getByRole('button', { name: 'Use as default' })).toBeDisabled();
    // What is in use now cannot be chosen again.
    expect(within(socket).getByRole('button', { name: 'Use as default' })).toBeDisabled();
  });

  it('"Use for this session" and "Use as default" send the PUT with the write token, then ask the status again', async () => {
    status = twoTransports();
    status.transports[1] = { ...status.transports[1]!, available: true, reason: 'hc is reachable', fix: '' };
    const panel = await openPicker();
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    const hc = panel.querySelector('[data-transport="hc"]') as HTMLElement;
    fireEvent.click(within(hc).getByRole('button', { name: 'Use for this session' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toMatchObject({ url: expect.stringMatching(/\/sessions\/.+\/reply\/transport$/), body: { transportId: 'hc' }, token: 'test-token' });
    await waitFor(() => expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(calls + 1));
    fireEvent.click(within(hc).getByRole('button', { name: 'Use as default' }));
    await waitFor(() => expect(puts).toHaveLength(2));
    expect(puts[1]).toMatchObject({ url: expect.stringMatching(/\/reply\/transport\/default$/), body: { transportId: 'hc' }, token: 'test-token' });
  });

  it('"Follow the default" appears only with an override and sends transportId null', async () => {
    status = twoTransports({ sessionOverrideTransportId: 'socket' });
    status.transports[0] = { ...status.transports[0]!, sessionOverride: true };
    await openPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Follow the default (socket)' }));
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]?.body).toEqual({ transportId: null });
  });

  it('a refused change is written in the popover with its hint', async () => {
    status = twoTransports();
    status.transports[1] = { ...status.transports[1]!, available: true, reason: 'reachable', fix: '' };
    putAnswer = () => ({ status: 400, body: { ok: false, error: { code: 'unknown-transport', message: "'hc' is not a transport", hint: 'valid ids: socket' } } });
    const panel = await openPicker();
    fireEvent.click(within(panel.querySelector('[data-transport="hc"]') as HTMLElement).getByRole('button', { name: 'Use for this session' }));
    expect(await within(panel).findByRole('alert')).toHaveTextContent("'hc' is not a transport. valid ids: socket");
  });

  it('a typed transport in use shows a cue next to the send button and the warning only in tooltips', async () => {
    const typed = twoTransports();
    typed.transports[0] = { ...typed.transports[0]!, selected: false };
    typed.transports[1] = { ...typed.transports[1]!, selected: true, available: true, reason: 'ok', fix: '' };
    status = typed;
    render(<Composer session={session} />);
    const cue = await screen.findByLabelText('Sends as typed by you');
    expect(screen.queryByText(/typed into the terminal as if you had written it/)).toBeNull();
    fireEvent.focus(cue);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/Sends as typed by you.*typed into the terminal as if you had written it/);
    expect(screen.getByRole('button', { name: 'Transport: hc' })).toBeInTheDocument();
  });

  it('no cue for a peer transport', async () => {
    render(<Composer session={session} />);
    await screen.findByRole('button', { name: 'Transport: socket' });
    expect(screen.queryByLabelText('Sends as typed by you')).toBeNull();
  });
});

describe('probing is lazy: every transport is probed only while the menu is open', () => {
  const statusUrls = (): string[] => vi.mocked(fetch).mock.calls.map((call) => String(call[0])).filter((url) => url.includes('/reply/status'));

  it('the plain status asks without probe=all, opening the menu asks with it, closing it goes back', async () => {
    render(<Composer session={session} />);
    const button = await screen.findByRole('button', { name: 'Transport: socket' });
    expect(statusUrls().every((url) => !url.includes('probe=all'))).toBe(true);
    fireEvent.click(button);
    await waitFor(() => expect(statusUrls().some((url) => url.endsWith('/reply/status?probe=all'))).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Transport: socket' }));
    await waitFor(() => expect(statusUrls().at(-1)).not.toContain('probe=all'));
  });

  it('a transport that was not probed yet says it is being checked instead of "not available"', async () => {
    const base = twoTransports();
    status = { ...base, transports: base.transports.map((transport, index) => (index === 1 ? { ...transport, probed: false } : transport)) };
    const dialog = await openPicker();
    expect(within(dialog).getByText(/Checking whether it can deliver/)).toBeInTheDocument();
  });
});

describe('reply errors of the terminal transport are shown with their message and hint', () => {
  it.each([
    ['terminal-blocked', 'hc refused: a dialog is open', 'answer the dialog in its terminal first'],
    ['no-terminal', 'no terminal found for this session', 'open it in herdr'],
    ['ambiguous-terminal', 'two terminals match', 'close one of them'],
    ['terminal-gone', 'hc refused: no such terminal', 'the terminal ended; refresh the session list'],
    ['rate-limited', '5 replies were sent in the last 60 s', 'wait about 30 s, then send again'],
    ['text-too-long-for-hc', 'the reply is too long for the command line of hc', 'select the socket transport'],
    ['hc-missing', "the program 'hc' was not found", 'install herdr-core'],
    ['hc-timeout', 'hc did not answer within 10000 ms (send); it was stopped', 'the text may or may not have been typed: look at the terminal'],
  ])('%s', async (code, message, hint) => {
    const user = userEvent.setup();
    replyAnswer = () => ({ ok: false, error: { code, message, hint } });
    render(<Composer session={session} />);
    const box = screen.getByRole('textbox');
    await waitFor(() => expect(box).toBeEnabled());
    await user.type(box, 'hi{Enter}');
    const banner = await screen.findByText(/The message was not sent/);
    expect(banner).toHaveTextContent(message);
    expect(banner).toHaveTextContent(hint);
    expect(box).toHaveValue('hi');
  });
});
