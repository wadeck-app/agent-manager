import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { row } from '../deps.js';
import type { ReplyRequest } from '../deps.js';
import { getPending, resetPending } from '../pending.js';
import { Composer } from './Composer.js';
import { resetDrafts } from './draftStore.js';
import { statusFixture } from './fixtures.js';

type Handler = (body: ReplyRequest) => unknown;
let posts: ReplyRequest[];
let status = statusFixture();
let onPost: Handler;

const json = (body: unknown, httpStatus = 200): Response => new Response(JSON.stringify(body), { status: httpStatus });
const okReply = (body: ReplyRequest): unknown => ({ ok: true, deliveryState: 'sent', deliveryUi: 'delivered', transportId: 'socket', messageId: body.messageId, duplicate: false, auditWarning: '', imagesSaved: body.images?.length ?? 0 });

beforeEach(() => {
  posts = [];
  status = statusFixture();
  onPost = okReply;
  resetDrafts();
  resetPending();
  sessionStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as ReplyRequest;
        posts.push(body);
        return Promise.resolve(json(onPost(body)));
      }
      return Promise.resolve(json(status));
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const session = row({ displayName: 'billing-owner' });
const png = (size = 200, name = 'shot.png'): File => new File([new Uint8Array(size)], name, { type: 'image/png' });

async function ready(target = session): Promise<HTMLTextAreaElement> {
  render(<Composer session={target} />);
  const box = screen.getByRole<HTMLTextAreaElement>('textbox');
  await waitFor(() => expect(box).toBeEnabled());
  return box;
}

describe('Composer keyboard', () => {
  it('Enter sends the text and clears the box, the log gets an optimistic message', async () => {
    const user = userEvent.setup();
    const box = await ready();
    await user.type(box, 'hello agent{Enter}');
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ text: 'hello agent', priority: 'next' });
    expect(posts[0]?.confirmNow).toBeUndefined();
    await waitFor(() => expect(box).toHaveValue(''));
    expect(getPending(session.sessionId)[0]).toMatchObject({ text: 'hello agent', state: 'delivered' });
  });

  it('Shift+Enter adds a line and does not send', async () => {
    const user = userEvent.setup();
    const box = await ready();
    await user.type(box, 'a{Shift>}{Enter}{/Shift}b');
    expect(box).toHaveValue('a\nb');
    expect(posts).toHaveLength(0);
  });

  it('Ctrl+Enter sends too, Escape blurs', async () => {
    const user = userEvent.setup();
    const box = await ready();
    await user.type(box, 'x{Control>}{Enter}{/Control}');
    await waitFor(() => expect(posts).toHaveLength(1));
    await user.type(box, 'y');
    expect(box).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(box).not.toHaveFocus();
  });

  it('marks the field for the list shortcut', async () => {
    const box = await ready();
    expect(box).toHaveAttribute('data-agent-composer');
  });
});

describe('Composer drafts', () => {
  it('keeps the text per session when switching', async () => {
    const user = userEvent.setup();
    const other = row({ displayName: 'docs' });
    const view = render(<Composer session={session} />);
    const first = screen.getByRole('textbox');
    await waitFor(() => expect(first).toBeEnabled());
    await user.type(first, 'draft one');
    view.rerender(<Composer session={other} />);
    expect(screen.getByRole('textbox')).toHaveValue('');
    view.rerender(<Composer session={session} />);
    expect(screen.getByRole('textbox')).toHaveValue('draft one');
    expect(sessionStorage.getItem(`agent-manager.draft.${session.sessionId}`)).toBe('draft one');
  });
});

describe('Composer images', () => {
  it('attaches a pasted image, shows it with its size and sends it as base64', async () => {
    const user = userEvent.setup();
    const box = await ready();
    fireEvent.paste(box, { clipboardData: { files: [png(300)], items: [], getData: () => '' } });
    await screen.findByRole('img', { name: 'shot.png' });
    expect(screen.getByText('300 B')).toBeInTheDocument();
    await user.type(box, 'see{Enter}');
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]?.images).toHaveLength(1);
    expect(posts[0]?.images?.[0]).toMatchObject({ name: 'shot.png', mime: 'image/png' });
    expect(posts[0]?.images?.[0]?.dataBase64.length).toBeGreaterThan(0);
  });

  it('removes an attached image', async () => {
    const box = await ready();
    fireEvent.paste(box, { clipboardData: { files: [png()], items: [], getData: () => '' } });
    await screen.findByRole('img', { name: 'shot.png' });
    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove shot.png' }));
    expect(screen.queryByRole('img', { name: 'shot.png' })).toBeNull();
  });

  it('two quick pastes keep both images', async () => {
    const box = await ready();
    fireEvent.paste(box, { clipboardData: { files: [png(100, 'a.png')], items: [], getData: () => '' } });
    fireEvent.paste(box, { clipboardData: { files: [png(100, 'b.png')], items: [], getData: () => '' } });
    await screen.findByRole('img', { name: 'b.png' });
    expect(screen.getByRole('img', { name: 'a.png' })).toBeInTheDocument();
  });

  it('Send waits while an image is being prepared and says why, then works with the image', async () => {
    const user = userEvent.setup();
    const box = await ready();
    await user.type(box, 'look');
    fireEvent.paste(box, { clipboardData: { files: [png(100, 'a.png')], items: [], getData: () => '' } });
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/Preparing the image/);
    // Enter during the attach does not send either
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(posts).toHaveLength(0);
    await screen.findByRole('img', { name: 'a.png' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]?.images).toHaveLength(1);
    // the sent image does not come back
    await waitFor(() => expect(screen.queryByRole('img', { name: 'a.png' })).toBeNull());
  });

  it('an image removed while another one is being attached stays removed', async () => {
    const box = await ready();
    fireEvent.paste(box, { clipboardData: { files: [png(100, 'a.png')], items: [], getData: () => '' } });
    await screen.findByRole('img', { name: 'a.png' });
    fireEvent.paste(box, { clipboardData: { files: [png(100, 'b.png')], items: [], getData: () => '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove a.png' }));
    await screen.findByRole('img', { name: 'b.png' });
    expect(screen.queryByRole('img', { name: 'a.png' })).toBeNull();
  });

  it('accepts a dropped image', async () => {
    const box = await ready();
    fireEvent.drop(box.parentElement as HTMLElement, { dataTransfer: { files: [png(100, 'drop.png')] } });
    await screen.findByRole('img', { name: 'drop.png' });
  });

  it('refuses an image over the limit and says how to fix it', async () => {
    const reencode = vi.fn(() => Promise.resolve(new Blob([new Uint8Array(500_000)])));
    render(<Composer session={row()} reencode={reencode} />);
    const box = screen.getByRole('textbox');
    await waitFor(() => expect(box).toBeEnabled());
    fireEvent.paste(box, { clipboardData: { files: [png(300_000, 'huge.png')], items: [], getData: () => '' } });
    await screen.findByText(/huge\.png .* is too large .* Crop it/);
    expect(screen.queryByRole('img', { name: 'huge.png' })).toBeNull();
  });

  it('refuses a type that is not an image', async () => {
    const box = await ready();
    fireEvent.drop(box.parentElement as HTMLElement, { dataTransfer: { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] } });
    await screen.findByText(/application\/pdf: only PNG, JPEG, GIF and WebP/);
  });

  it('tells the user when it shrank an image', async () => {
    render(<Composer session={row()} reencode={() => Promise.resolve(new Blob([new Uint8Array(50_000)]))} />);
    const box = screen.getByRole('textbox');
    await waitFor(() => expect(box).toBeEnabled());
    fireEvent.paste(box, { clipboardData: { files: [png(300_000, 'big.png')], items: [], getData: () => '' } });
    await screen.findByText(/big\.jpg: Shrunk from/);
    expect(screen.getByRole('img', { name: 'big.jpg' })).toBeInTheDocument();
  });

  it('refuses a text over the limit before any request', async () => {
    status = { ...statusFixture(), limits: { ...statusFixture().limits, maxTextChars: 5 } };
    const user = userEvent.setup();
    const box = await ready();
    await user.type(box, 'toolong{Enter}');
    await screen.findByText(/limit is 5/);
    expect(posts).toHaveLength(0);
    expect(box).toHaveValue('toolong');
  });
});

describe('Composer errors and delivery', () => {
  it('shows the error with its hint, keeps the text and reuses the message id on retry', async () => {
    const user = userEvent.setup();
    onPost = () => ({ ok: false, error: { code: 'transport-unavailable', message: 'The pipe refused the connection', hint: 'Restart the session' } });
    const box = await ready();
    await user.type(box, 'again{Enter}');
    await screen.findByText(/not sent.*The pipe refused the connection\. Restart the session/);
    expect(box).toHaveValue('again');
    expect(getPending(session.sessionId)[0]).toMatchObject({ state: 'failed' });
    onPost = okReply;
    await user.type(box, '{Enter}');
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]?.messageId).toBe(posts[0]?.messageId);
    expect(getPending(session.sessionId)).toHaveLength(1);
    await waitFor(() => expect(box).toHaveValue(''));
  });

  it('shows an unreachable server as an error and keeps the draft', async () => {
    const user = userEvent.setup();
    const box = await ready();
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))));
    await user.type(box, 'hi{Enter}');
    await screen.findByText(/Cannot reach the app-core server/);
    expect(box).toHaveValue('hi');
  });

  it('has no list of the last messages under the box: the delivery is a mark on each sent bubble of the log', async () => {
    await ready();
    await screen.findByRole('button', { name: 'Transport: socket' });
    expect(screen.queryByRole('button', { name: /Last messages/ })).toBeNull();
    expect(screen.queryByText('earlier')).toBeNull();
  });

  it('names the transport read-only', async () => {
    await ready();
    expect(await screen.findByRole('button', { name: 'Transport: socket' })).toBeInTheDocument();
  });
});

describe('Composer limits', () => {
  it('does not show the limits as a permanent line', async () => {
    await ready();
    expect(screen.queryByText(/Up to \d+ images/)).toBeNull();
  });

  it('says them in the tooltip of the attach button, on keyboard focus too', async () => {
    await ready();
    const attach = screen.getByRole('button', { name: 'Attach images' });
    // The attach button is the base icon button: the limits are its native title.
    expect(attach.getAttribute('title')).toMatch(/Up to 2 images of .* each, .* in all\./);
  });

  it('shows a counter on the attach button once an image is attached, and names it', async () => {
    const box = await ready();
    expect(screen.queryByText('1/2')).toBeNull();
    fireEvent.paste(box, { clipboardData: { files: [png(100, 'a.png')], items: [], getData: () => '' } });
    await screen.findByRole('img', { name: 'a.png' });
    expect(screen.getByText('1/2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Attach images (1 of 2 attached)' })).toBeInTheDocument();
  });

  it('keeps a clean wrapper for the transport (the selector of #38 goes there), small, next to the name', async () => {
    await ready();
    const wrapper = document.querySelector('[data-composer-transport]');
    expect(wrapper).not.toBeNull();
    expect(wrapper).toHaveTextContent('socket');
  });
});

describe('Composer interrupt now', () => {
  it('sends directly with confirmNow, with no confirmation step', async () => {
    const user = userEvent.setup();
    const box = await ready();
    await user.click(screen.getByRole('button', { name: /Interrupt now/ }));
    await user.type(box, 'stop{Enter}');
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ text: 'stop', priority: 'now', confirmNow: true });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Interrupt and send' })).toBeNull();
  });

  it('shows what is armed: the chip, the orange send button with its own name, and the placeholder', async () => {
    const user = userEvent.setup();
    const box = await ready();
    await user.click(screen.getByRole('button', { name: /Interrupt now/ }));
    expect(screen.getByRole('button', { name: /Interrupt now/ })).toHaveAttribute('aria-pressed', 'true');
    const send = screen.getByRole('button', { name: 'Send and interrupt now' });
    expect(send.className).toMatch(/bg-danger/);
    expect(box).toHaveAttribute('placeholder', expect.stringContaining('Interrupt now is armed'));
  });

  it('goes back to After current step after a send, and the next message is a normal one', async () => {
    const user = userEvent.setup();
    const box = await ready();
    await user.click(screen.getByRole('button', { name: /Interrupt now/ }));
    await user.type(box, 'stop{Enter}');
    await waitFor(() => expect(posts).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /After current step/ })).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    await user.type(box, 'again{Enter}');
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]).toMatchObject({ priority: 'next' });
    expect(posts[1]?.confirmNow).toBeUndefined();
  });

  it('a FAILED interrupting send disarms the mode, says so, and the retry goes out as a normal message', async () => {
    const user = userEvent.setup();
    onPost = () => ({ ok: false, error: { code: 'transport-unavailable', message: 'The pipe refused the connection', hint: 'Restart the session' } });
    const box = await ready();
    await user.click(screen.getByRole('button', { name: /Interrupt now/ }));
    await user.type(box, 'stop{Enter}');
    await screen.findByText(/Interrupt now was reset to After current step; arm it again to retry/);
    expect(posts[0]).toMatchObject({ priority: 'now', confirmNow: true });
    expect(screen.getByRole('button', { name: /After current step/ })).toHaveAttribute('aria-pressed', 'true');
    expect(box).toHaveValue('stop');
    onPost = okReply;
    await user.type(box, '{Enter}');
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts[1]).toMatchObject({ priority: 'next' });
    expect(posts[1]?.confirmNow).toBeUndefined();
  });

  it('the priority is After current step on mount and again on every session switch', async () => {
    const user = userEvent.setup();
    const first = row({ sessionId: '00000000-0000-4000-8000-0000000000a1', displayName: 'first-owner' });
    const second = row({ sessionId: '00000000-0000-4000-8000-0000000000a2', displayName: 'second-owner' });
    const view = render(<Composer session={first} />);
    await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
    expect(screen.getByRole('button', { name: /After current step/ })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: /Interrupt now/ }));
    expect(screen.getByRole('button', { name: /Interrupt now/ })).toHaveAttribute('aria-pressed', 'true');
    view.rerender(<Composer session={second} />);
    await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
    expect(screen.getByRole('button', { name: /After current step/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Interrupt now/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('puts the warning in the tooltip of the chip, on keyboard focus too, and says the mode is for one message', async () => {
    await ready();
    const chip = screen.getByRole('button', { name: /Interrupt now/ });
    fireEvent.focus(chip);
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent(/aborts the tool call the agent is running right now/);
    expect(tip).toHaveTextContent(/work in that call is lost/);
    expect(tip).toHaveTextContent(/one message only/);
    expect(chip.getAttribute('aria-describedby')).toContain(tip.id);
  });
});

describe('Composer disabled', () => {
  it('shows why a dead session cannot be written to, the box stays visible', async () => {
    render(<Composer session={row({ alive: false })} />);
    expect(screen.getByText(/has ended/)).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('shows the reason and the fix of an unavailable transport', async () => {
    status = statusFixture({ transportAvailable: false });
    render(<Composer session={session} />);
    await screen.findByText(/socket transport cannot reach this session: no token file\. create the token file/);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('explains a status that cannot be read, with Retry', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(json({ ok: false, error: { code: 'x', message: 'Registry unreadable', hint: 'Check the folder' } }))));
    render(<Composer session={session} />);
    await screen.findByText(/could not be read.*Registry unreadable\. Check the folder/);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('Composer for a Background session', () => {
  it('says once that the message goes as a peer message, next to the transport', async () => {
    await ready(row({ displayName: 'bg-one', launchedBy: 'agent-manager', host: 'bg', ownedState: 'idle' }));
    expect(await screen.findByText('Sent as a peer message (a background session has no direct pipe)')).toBeInTheDocument();
  });

  it('says nothing when the selected transport is not the socket (the note would be false)', async () => {
    status = { ...statusFixture(), selectedTransportId: 'hc', transports: statusFixture().transports.map((transport) => ({ ...transport, transportId: 'hc' })) };
    await ready(row({ displayName: 'bg-two', launchedBy: 'agent-manager', host: 'bg', ownedState: 'idle' }));
    await screen.findByRole('button', { name: 'Transport: hc' });
    expect(screen.queryByText(/peer message \(a background session/)).toBeNull();
  });

  it('says nothing of the kind for another session', async () => {
    await ready();
    expect(screen.queryByText(/peer message \(a background session/)).toBeNull();
  });
});

describe('Composer placeholder on a phone', () => {
  it('is short enough for one line on a narrow screen, and complete on a wide one', async () => {
    const wide = await ready();
    expect(wide).toHaveAttribute('placeholder', 'Message the agent (Enter sends, Shift+Enter adds a line)');
    cleanup();
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('max-width'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
    const narrow = await ready();
    expect(narrow).toHaveAttribute('placeholder', 'Message the agent');
  });
});
