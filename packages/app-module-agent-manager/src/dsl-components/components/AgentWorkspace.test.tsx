import { UrlParamContext, type UrlParamService } from '@wadeck-app/dsl-ui';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { statusFixture } from '../detail/composer/fixtures.js';
import { failureText } from '../data/http.js';
import { row } from '../logic/fixtures.js';
import { toggleStateToken } from '../logic/fuzzy.js';
import { groupByHarness } from '../logic/harness.js';
import { checkVariant, LIST_STYLES } from '../shared.js';
import { clampWidth, DEFAULT_LIST_WIDTH, MAX_LIST_WIDTH, MIN_LIST_WIDTH, SplitPane } from '../ui/SplitPane.js';
import { tabbableId } from '../ui/hooks.js';
import { AgentWorkspace } from './AgentWorkspace.js';

function Page({ children, initial = {} }: { children: ReactNode; initial?: Record<string, string> }) {
  const [params, setParams] = useState<Record<string, string>>(initial);
  const service: UrlParamService = { get: (key) => params[key] ?? null, set: (key, value) => setParams((current) => ({ ...current, [key]: value })) };
  return (
    <UrlParamContext.Provider value={service}>
      {children}
      <div data-testid="url">{params['session'] ?? ''}</div>
      <div data-testid="show">{params['show'] ?? ''}</div>
    </UrlParamContext.Provider>
  );
}

const json = (body: unknown, ok = true, status = 200): Response => ({ ok, status, json: async () => body }) as unknown as Response;

/** A log answer with no entry: the detail pane has nothing to say, the tests look at the header and the list. */
const EMPTY_LOG = {
  ok: true,
  sessionId: 's',
  entries: [],
  cursor: null,
  olderCursor: null,
  more: false,
  subagents: [],
  subagentsNote: '',
  activity: { scope: 'window', runningToolCalls: [], tokensTotal: 0, contextEstimate: 0, turnsCount: 0, errorsCount: 0 },
  truncated: { fieldsCut: 0, bodyCapped: false, unreadableLines: 0 },
  limits: { textChars: 20000, inputChars: 8192, resultPreviewChars: 500, maxEntries: 500, maxBodyBytes: 1048576 },
  note: '',
};

/** Routes the calls of the page: the log and the reply status of the detail pane, and the pin / seen actions (`post` answers them). */
function stubFetch(post: (url: string, body: unknown) => Response = () => json({ ok: true })): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return post(url, init.body === undefined ? undefined : JSON.parse(init.body as string));
    }
    if (url.includes('/reply/status')) {
      return json(statusFixture());
    }
    if (url.includes('/log')) {
      return json(EMPTY_LOG);
    }
    throw new Error(`unexpected request ${url}`);
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

const SHOP = row({ folder: 'shop', displayName: 'shop-owner', state: 'needs-you', reason: 'permission prompt' });
const DOCS = row({ folder: 'docs', state: 'idle' });

describe('AgentWorkspace', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports a wrong list or variant on the page instead of falling back', () => {
    render(
      <Page>
        <AgentWorkspace list={'nope' as 'groups'} variant="compact" />
      </Page>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('list is "nope". Use one of: groups, inbox, tree, tabs-cards, palette.');
  });

  it('shows a loading state while the page has no answer, then the sessions it is given, and makes no request of its own for the list', async () => {
    const mock = stubFetch();
    const { rerender } = render(
      <Page>
        <AgentWorkspace list="groups" variant="compact" />
      </Page>,
    );
    expect(screen.getByRole('status', { name: 'Loading the sessions' })).toBeInTheDocument();
    rerender(
      <Page>
        <AgentWorkspace list="groups" variant="compact" sessions={[SHOP, DOCS]} />
      </Page>,
    );
    expect(within(await screen.findByRole('listbox', { name: 'Agents' })).getAllByRole('option')).toHaveLength(2);
    expect(screen.getByText('Select an agent')).toBeInTheDocument();
    // One request for the list is the page's; the workspace itself asks for nothing until a session is open.
    expect(mock).not.toHaveBeenCalled();
  });

  it('has a slim toolbar: the title, the count, a filter that writes the show URL parameter, and the shortcut help', () => {
    stubFetch();
    render(
      <Page>
        <AgentWorkspace list="groups" variant="compact" sessions={[SHOP, DOCS]} hiddenDead={3} />
      </Page>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Agents' })).toBeInTheDocument();
    expect(screen.getByText('2 sessions, 3 ended hidden')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Sessions to show'), { target: { value: 'all' } });
    expect(screen.getByTestId('show').textContent).toBe('all');
    expect(screen.getByRole('button', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
  });

  it('opens the detail of the selected session: header with name, state, pid, pin and mark-seen, then the log and the reply box', async () => {
    stubFetch();
    render(
      <Page initial={{ session: SHOP.sessionId }}>
        <AgentWorkspace list="groups" variant="compact" sessions={[SHOP, DOCS]} logStyle="chat" />
      </Page>,
    );
    expect(await screen.findByRole('heading', { name: 'shop-owner' })).toBeInTheDocument();
    expect(screen.getByText(/^pid /)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pin' })).toBeEnabled();
    // Not Done: marking has nothing to mark, and the button says so.
    expect(screen.getByRole('button', { name: 'Mark as seen' })).toBeDisabled();
    expect(document.querySelector('[data-agent-composer]')).not.toBeNull();
  });

  it('pins at once (the list answers before the server), and a refused pin is reverted and shown with its hint', async () => {
    const mock = stubFetch(() => json({ error: 'BAD_REQUEST', message: 'state file is not valid JSON', hint: 'Fix or delete it.' }, false, 500));
    render(
      <Page initial={{ session: SHOP.sessionId }}>
        <AgentWorkspace list="groups" variant="compact" sessions={[SHOP, DOCS]} logStyle="chat" />
      </Page>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Pin' }));
    expect(await screen.findByText(/Could not pin the session: state file is not valid JSON. Fix or delete it./)).toBeInTheDocument();
    const post = mock.mock.calls.find((call) => (call[1] as RequestInit | undefined)?.method === 'POST');
    expect(post?.[0]).toBe(`/api/modules/agent-manager/sessions/${SHOP.sessionId}/pin`);
    expect(JSON.parse((post?.[1] as RequestInit).body as string)).toEqual({ pinned: true });
    // Reverted: the button offers the pin again.
    expect(screen.getByRole('button', { name: 'Pin' })).toBeInTheDocument();
  });

  it('a successful pin shows the Pinned group straight away and the p shortcut unpins', async () => {
    stubFetch();
    render(
      <Page initial={{ session: SHOP.sessionId }}>
        <AgentWorkspace list="groups" variant="compact" sessions={[SHOP, DOCS]} logStyle="chat" />
      </Page>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Pin' }));
    expect(await screen.findByRole('button', { name: 'Pinned, 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unpin' })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'p' });
    expect(await screen.findByRole('button', { name: 'Pin' })).toBeInTheDocument();
  });

  it('shows the pins error of the page answer', () => {
    stubFetch();
    render(
      <Page>
        <AgentWorkspace list="tree" variant="expanded" sessions={[SHOP]} userStateError="agents-user-state.json is not valid JSON. Fix or delete it." />
      </Page>,
    );
    expect(screen.getByText('agents-user-state.json is not valid JSON. Fix or delete it.')).toBeInTheDocument();
  });

  it('says so when the selected session is not in the list, and can close it', async () => {
    stubFetch();
    render(
      <Page initial={{ session: 'ffffffff-0000-4000-8000-000000000000' }}>
        <AgentWorkspace list="groups" variant="compact" sessions={[SHOP]} />
      </Page>,
    );
    expect(await screen.findByText(/is not in the list/)).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Close this session' }));
    });
    expect(screen.getByTestId('url').textContent).toBe('');
  });

  it('Escape with nothing focused closes the selected session', async () => {
    stubFetch();
    render(
      <Page initial={{ session: SHOP.sessionId }}>
        <AgentWorkspace list="groups" variant="compact" sessions={[SHOP]} logStyle="chat" />
      </Page>,
    );
    await screen.findByRole('heading', { name: 'shop-owner' });
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.getByTestId('url').textContent).toBe('');
  });

  it('marks a Done session seen once it has stayed open', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const done = row({ folder: 'docs', state: 'done', seen: false, statusUpdatedAt: 5 });
      const mock = stubFetch();
      render(
        <Page initial={{ session: done.sessionId }}>
          <AgentWorkspace list="groups" variant="compact" sessions={[done]} logStyle="chat" />
        </Page>,
      );
      await screen.findByRole('heading', { name: 'docs' });
      expect(mock.mock.calls.some((call) => String(call[0]).endsWith('/seen'))).toBe(false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1600);
      });
      expect(mock.mock.calls.some((call) => String(call[0]).endsWith(`${done.sessionId}/seen`))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('helpers', () => {
  it('checkVariant accepts every declared pair and refuses the others with the allowed values', () => {
    for (const [list, styles] of Object.entries(LIST_STYLES)) {
      for (const style of styles) {
        expect(checkVariant(list, style).ok).toBe(true);
      }
      expect(checkVariant(list, 'bogus')).toEqual({ ok: false, text: expect.stringContaining(`Use one of: ${styles.join(', ')}`) });
    }
    expect(checkVariant(undefined, 'x').ok).toBe(false);
  });

  it('failureText reads both error shapes and falls back to the status', () => {
    expect(failureText({ error: 'BAD_REQUEST', message: 'bad id', hint: 'use a uuid' }, 400)).toBe('bad id. use a uuid');
    expect(failureText({ ok: false, error: { code: 'c', message: 'gone', hint: 'wait' } }, 404)).toBe('gone. wait');
    expect(failureText({ errorText: 'one line' }, 200)).toBe('one line');
    expect(failureText(null, 502)).toContain('HTTP 502');
  });

  it('toggleStateToken adds, removes, and keeps the other words', () => {
    expect(toggleStateToken('shop', 'done')).toBe('shop state:done');
    expect(toggleStateToken('shop state:done', 'done')).toBe('shop');
    expect(toggleStateToken('state:don', 'done')).toBe('');
  });

  it('groupByHarness orders by version number, not by text', () => {
    const groups = groupByHarness([row({ version: '2.1.9' }), row({ version: '2.1.10' }), row({ version: undefined })]);
    expect(groups.map((group) => group.version)).toEqual(['2.1.10', '2.1.9', undefined]);
  });

  it('tabbableId keeps the tab stop on the selection, else the first row', () => {
    expect(tabbableId(['a', 'b'], 'b')).toBe('b');
    expect(tabbableId(['a', 'b'], 'zz')).toBe('a');
    expect(tabbableId([], undefined)).toBeUndefined();
  });
});

describe('SplitPane', () => {
  afterEach(() => window.localStorage.clear());

  it('clamps the width', () => {
    expect(clampWidth(10)).toBe(MIN_LIST_WIDTH);
    expect(clampWidth(9999)).toBe(MAX_LIST_WIDTH);
    expect(clampWidth(300.4)).toBe(300);
  });

  it('resizes from the keyboard, keeps the width, and exposes the separator to assistive technology', () => {
    const { unmount } = render(<SplitPane list={<div>list</div>} detail={<div>detail</div>} detailOpen={false} />);
    const separator = screen.getByRole('separator', { name: 'Resize the agent list' });
    expect(separator).toHaveAttribute('aria-valuenow', String(DEFAULT_LIST_WIDTH));
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator).toHaveAttribute('aria-valuenow', String(DEFAULT_LIST_WIDTH + 16));
    fireEvent.keyDown(separator, { key: 'End' });
    expect(separator).toHaveAttribute('aria-valuenow', String(MAX_LIST_WIDTH));
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator).toHaveAttribute('aria-valuenow', String(MIN_LIST_WIDTH));
    unmount();
    render(<SplitPane list={<div>list</div>} detail={<div>detail</div>} detailOpen={false} />);
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', String(MIN_LIST_WIDTH));
  });

  it('has no separator with a fixed width, and stacks: the list hides when a session is open', () => {
    const { container } = render(<SplitPane list={<div>list</div>} detail={<div>detail</div>} detailOpen fixedWidth={56} />);
    expect(screen.queryByRole('separator')).toBeNull();
    expect(container.querySelector('[data-pane=list]')?.className).toContain('hidden lg:flex');
    expect(container.querySelector('[data-pane=detail]')?.className).toContain('flex');
  });
});
