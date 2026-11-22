import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { statusFixture } from '../detail/composer/fixtures.js';
import type { GroupsApi } from '../lists/common.js';
import { SelectionProvider, useSelection } from '../lists/selection.js';
import { row } from '../logic/fixtures.js';
import { agentId } from '../logic/states.js';
import type { BatchRecipientResult, CustomGroupDto } from '../shared.js';
import { SelectedBar } from './SelectedBar.js';
import type { AgentRow } from '../data/types.js';

const json = (body: unknown, httpStatus = 200): Response => new Response(JSON.stringify(body), { status: httpStatus });

const billing = row({ displayName: 'billing-owner', state: 'idle' });
const docs = row({ displayName: 'docs-writer', state: 'done', pinned: false });
const legacy = row({ displayName: 'legacy-owner', alive: false, state: 'ended' });
const offline = row({ displayName: 'no-socket', state: 'idle' });

let posts: { path: string; body: { ids: string[]; text: string; requestId: string } }[];
let batchAnswer: (body: { ids: string[] }) => unknown;
let statusOf: (id: string) => Response;

beforeEach(() => {
  posts = [];
  batchAnswer = (body) => ({ ok: true, results: body.ids.map((id): BatchRecipientResult => ({ id, name: `name-${id.slice(-4)}`, state: 'sent', reason: '' })), counts: { sent: body.ids.length, queued: 0, refused: 0, 'maybe-sent': 0, failed: 0 } });
  statusOf = (id) => (id === agentId(offline) ? json(statusFixture({ transportAvailable: false })) : json(statusFixture()));
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { ids: string[]; text: string; requestId: string };
        posts.push({ path: url, body });
        return Promise.resolve(json(batchAnswer(body)));
      }
      const id = /sessions\/([^/]+)\/reply\/status/.exec(url)?.[1];
      return Promise.resolve(id === undefined ? json({}, 404) : statusOf(id));
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function Ticks({ rows }: { rows: readonly AgentRow[] }) {
  const selection = useSelection();
  return (
    <div>
      {rows.map((session) => (
        <button key={agentId(session)} type="button" onClick={() => selection?.toggle(agentId(session))}>
          {`tick ${session.displayName}`}
        </button>
      ))}
    </div>
  );
}

function Harness({ rows, groups, onPin = vi.fn(), onSeen = vi.fn() }: { rows: AgentRow[]; groups?: GroupsApi; onPin?: (rows: readonly AgentRow[], pinned: boolean) => void; onSeen?: (rows: readonly AgentRow[]) => void }) {
  return (
    <SelectionProvider existing={new Set(rows.map(agentId))}>
      <Ticks rows={rows} />
      <SelectedBar rows={rows} groups={groups} onPin={onPin} onSeen={onSeen} />
    </SelectionProvider>
  );
}

const tick = (...names: string[]): void => {
  for (const name of names) {
    fireEvent.click(screen.getByRole('button', { name: `tick ${name}` }));
  }
};

describe('the batch bar', () => {
  it('is absent with no selection, then says how many are selected and offers the actions', () => {
    render(<Harness rows={[billing, docs]} />);
    expect(screen.queryByRole('toolbar')).toBeNull();
    tick('billing-owner', 'docs-writer');
    const bar = screen.getByRole('toolbar', { name: 'Actions on the selected sessions' });
    expect(within(bar).getByText('2 selected')).toBeInTheDocument();
    for (const name of ['Send a message...', 'Mark as seen', 'Pin', 'Move to group', 'Add / remove bypass']) {
      expect(within(bar).getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('Add / remove bypass is drawn off, with the reason as its tooltip', () => {
    render(<Harness rows={[billing]} />);
    tick('billing-owner');
    const button = screen.getByRole('button', { name: 'Add / remove bypass' });
    expect(button).toBeDisabled();
    expect(button.closest('span[title]')).toHaveAttribute('title', 'Needs POST /api/auth/verify of app-core (pending)');
  });

  it('Mark as seen acts on the finished sessions only, and is off with the reason when none is', () => {
    const onSeen = vi.fn();
    const { unmount } = render(<Harness rows={[billing, docs]} onSeen={onSeen} />);
    tick('billing-owner', 'docs-writer');
    fireEvent.click(screen.getByRole('button', { name: 'Mark as seen' }));
    expect(onSeen).toHaveBeenCalledWith([docs]);
    unmount();
    render(<Harness rows={[billing]} />);
    tick('billing-owner');
    const off = screen.getByRole('button', { name: 'Mark as seen' });
    expect(off).toBeDisabled();
    expect(off.closest('span[title]')?.getAttribute('title')).toContain('nothing to mark');
  });

  it('Pin pins the ones that are not, and becomes Unpin when all are pinned', () => {
    const onPin = vi.fn();
    const pinned = row({ displayName: 'already', pinned: true });
    const { unmount } = render(<Harness rows={[billing, pinned]} onPin={onPin} />);
    tick('billing-owner', 'already');
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    expect(onPin).toHaveBeenCalledWith([billing], true);
    unmount();
    const onUnpin = vi.fn();
    render(<Harness rows={[pinned]} onPin={onUnpin} />);
    tick('already');
    fireEvent.click(screen.getByRole('button', { name: 'Unpin' }));
    expect(onUnpin).toHaveBeenCalledWith([pinned], false);
  });

  it('Move to group moves every selected session with the page API and clears the selection', () => {
    const group: CustomGroupDto = { id: 'g1', name: 'Reviews', color: null, collapsed: false, order: 0, sort: 'manual', bodyColor: null };
    const move = vi.fn();
    const groups = { groups: [group], move, create: vi.fn(), update: vi.fn(), seedHerdr: vi.fn(), remove: vi.fn(), reorder: vi.fn() } as unknown as GroupsApi;
    render(<Harness rows={[billing, docs]} groups={groups} />);
    tick('billing-owner', 'docs-writer');
    fireEvent.click(screen.getByRole('button', { name: 'Move to group' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Reviews/ }));
    expect(move.mock.calls.map((call) => call.slice(0, 2))).toEqual([
      [agentId(billing), 'g1'],
      [agentId(docs), 'g1'],
    ]);
    expect(screen.queryByRole('toolbar')).toBeNull();
  });
});

describe('the batch send dialog', () => {
  async function open(rows: AgentRow[], names: string[]): Promise<HTMLElement> {
    render(<Harness rows={rows} />);
    tick(...names);
    fireEvent.click(screen.getByRole('button', { name: 'Send a message...' }));
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(within(dialog).queryByText('Checking its transport...')).toBeNull());
    return dialog;
  }

  it('lists the recipients with the ones that cannot receive it unticked and skipped with the reason, and previews who gets it', async () => {
    const dialog = await open([billing, legacy, offline], ['billing-owner', 'legacy-owner', 'no-socket']);
    expect(within(dialog).getByRole('checkbox', { name: 'Send to billing-owner' })).toBeChecked();
    const dead = within(dialog).getByRole('checkbox', { name: 'Send to legacy-owner' });
    expect(dead).not.toBeChecked();
    expect(dead).toBeDisabled();
    expect(within(dialog).getByText(/The session is not running/)).toBeInTheDocument();
    expect(within(dialog).getByText(/The socket transport is not available: no token file. Fix: create the token file/)).toBeInTheDocument();
    expect(within(dialog).getByText(/1 will receive it, 2 skipped/)).toBeInTheDocument();
  });

  it('the Send button waits for a text, says why in its tooltip, then sends ONE request with the ticked ids and a request id', async () => {
    const user = userEvent.setup();
    const dialog = await open([billing, docs, legacy], ['billing-owner', 'docs-writer', 'legacy-owner']);
    const send = within(dialog).getByRole('button', { name: 'Send to 2' });
    expect(send).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox', { name: 'Message' }), 'please wrap up');
    expect(send).toBeEnabled();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Send to docs-writer' }));
    await user.click(within(dialog).getByRole('button', { name: 'Send to 1' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]?.path).toContain('/sessions/batch/reply');
    expect(posts[0]?.body).toMatchObject({ ids: [agentId(billing)], text: 'please wrap up', requestId: expect.stringMatching(/^b-/) });
  });

  it('shows the answer per recipient and keeps it until closed: sent, refused with the reason, maybe sent with the warning; a copy button', async () => {
    const user = userEvent.setup();
    batchAnswer = (body) => ({
      ok: true,
      results: [
        { id: body.ids[0], name: 'billing-owner', state: 'sent', reason: '' },
        { id: body.ids[1], name: 'docs-writer', state: 'refused', reason: 'The session has ended' },
        { id: body.ids[2], name: 'no-socket', state: 'maybe-sent', reason: 'timeout' },
      ],
      counts: { sent: 1, queued: 0, refused: 1, 'maybe-sent': 1, failed: 0 },
    });
    // Every transport is available here, so the three can be ticked.
    statusOf = () => json(statusFixture());
    const dialog = await open([billing, docs, offline], ['billing-owner', 'docs-writer', 'no-socket']);
    await user.type(within(dialog).getByRole('textbox', { name: 'Message' }), 'hello');
    const sendButton = within(dialog).getAllByRole('button').find((button) => /^Send to \d/.test(button.textContent ?? ''));
    expect(sendButton).toBeDefined();
    await user.click(sendButton as HTMLElement);
    const results = await screen.findByRole('list', { name: 'Results' });
    expect(document.querySelector('[data-batch-summary]')).toHaveTextContent('1 sent, 1 refused, 1 maybe sent');
    expect(within(results).getByText('The session has ended')).toBeInTheDocument();
    expect(screen.getByText(/may have the message/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy the results' })).toBeInTheDocument();
    // Never closed by itself.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // The retry offers the refused one only, never the maybe-sent one.
    expect(screen.getByRole('button', { name: 'Retry the 1 refused or failed' })).toBeInTheDocument();
  });

  it('a request that fails before an answer is shown with the PIN or network reason and the form stays, so the same request can be sent again', async () => {
    const user = userEvent.setup();
    batchAnswer = () => {
      throw new Error('unused');
    };
    const dialog = await open([billing], ['billing-owner']);
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return Promise.resolve(json({ ok: false, error: { code: 'pin-cancelled', message: 'Sensitive action cancelled', hint: 'Enter the PIN to send.' } }, 401));
        }
        return Promise.resolve(json(statusFixture()));
      }),
    );
    await user.type(within(dialog).getByRole('textbox', { name: 'Message' }), 'hello');
    await user.click(within(dialog).getByRole('button', { name: 'Send to 1' }));
    expect(await within(dialog).findByText(/Sensitive action cancelled/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Send to 1' })).toBeEnabled();
  });

  it('more than 20 ticked recipients: the Send button is off and the text says how many to untick', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 22 }, (_, i) => row({ displayName: `agent-${i}`, state: 'idle' }));
    const dialog = await open(many, many.map((session) => session.displayName));
    await user.type(within(dialog).getByRole('textbox', { name: 'Message' }), 'hello');
    expect(within(dialog).getByText(/at most 20 recipients: untick 2/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Send to 22' })).toBeDisabled();
  });
});
