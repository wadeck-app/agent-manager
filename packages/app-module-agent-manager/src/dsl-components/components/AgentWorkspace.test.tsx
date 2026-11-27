import { UrlParamContext, type UrlParamService } from '@wadeck-app/dsl-ui';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { statusFixture } from '../detail/composer/fixtures.js';
import { failureText } from '../data/http.js';
import { row } from '../logic/fixtures.js';
import { MODE_STORAGE_KEY } from '../logic/mode.js';
import { VIEW_OPTIONS_STORAGE_KEY } from '../logic/viewOptions.js';
import { clampWidth, DEFAULT_LIST_WIDTH, MAX_LIST_WIDTH, MIN_LIST_WIDTH, SplitPane } from '../ui/SplitPane.js';
import { tabbableId } from '../ui/hooks.js';
import { TrailSlot } from '../ui/TrailSlot.js';
import { expectNoticeDetails } from '../ui/noticeTestKit.js';
import { AgentWorkspace } from './AgentWorkspace.js';

/** The page: the URL parameters are state. The tests of the lists run in the Groups mode (the default of the page is Tree): pass `mode: ''` to get the default. */
function Page({ children, initial = {} }: { children: ReactNode; initial?: Record<string, string> }) {
  const [params, setParams] = useState<Record<string, string>>({ mode: 'groups', ...initial });
  const service: UrlParamService = { get: (key) => params[key] ?? null, set: (key, value) => setParams((current) => ({ ...current, [key]: value })) };
  return (
    <UrlParamContext.Provider value={service}>
      <TrailSlot>{children}</TrailSlot>
      <div data-testid="url">{params['session'] ?? ''}</div>
      <div data-testid="show">{params['show'] ?? ''}</div>
      <div data-testid="mode">{params['mode'] ?? ''}</div>
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
function stubFetch(post: (url: string, body: unknown) => Response = () => json({ ok: true }), status = statusFixture()): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      return post(url, init.body === undefined ? undefined : JSON.parse(init.body as string));
    }
    if (url.includes('/reply/status')) {
      return json(status);
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

  it('renders every root inside the scope wrapper (the stylesheet only styles descendants of .agents-scope), the error banner too', () => {
    const { container } = render(
      <Page>
        <AgentWorkspace sessions={[SHOP, DOCS]} />
      </Page>,
    );
    const scope = container.firstElementChild as HTMLElement;
    expect(scope).toHaveClass('agents-scope');
    // The wrapper holds the whole workspace: both panes are inside it, and nothing of the workspace is a sibling of it.
    expect(scope.querySelector('[data-pane="list"]')).not.toBeNull();
    expect(scope.querySelector('[data-pane="detail"]')).not.toBeNull();
    // The workspace box (toolbar and panes, no frame of its own around them) is the hook of the screen measures (poc/scripts/measure-workspace.js).
    const box = scope.querySelector('[data-agent-workspace]');
    expect(box).not.toBeNull();
    expect(box?.className).not.toMatch(/(border|rounded)/);
    expect(box?.querySelector('[data-pane="list"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-pane]')).toHaveLength(scope.querySelectorAll('[data-pane]').length);
  });

  it('shows a loading state while the page has no answer, then the sessions it is given, and makes no request of its own for the list', async () => {
    const mock = stubFetch();
    const { rerender } = render(
      <Page>
        <AgentWorkspace />
      </Page>,
    );
    expect(screen.getByRole('status', { name: 'Loading the sessions' })).toBeInTheDocument();
    rerender(
      <Page>
        <AgentWorkspace sessions={[SHOP, DOCS]} />
      </Page>,
    );
    expect(within(await screen.findByRole('listbox', { name: 'Agents' })).getAllByRole('option')).toHaveLength(2);
    expect(screen.getByText('Select an agent')).toBeInTheDocument();
    // One request for the list is the page's; the workspace itself asks for nothing until a session is open.
    expect(mock).not.toHaveBeenCalled();
  });

  it('says an empty registry once: one list message and a right pane that does not talk about selecting an agent (QA3 R6)', () => {
    stubFetch();
    render(
      <Page>
        <AgentWorkspace sessions={[]} />
      </Page>,
    );
    expect(screen.getAllByRole('status').map((element) => element.textContent)).toEqual(['No session to showStart Claude Code in a terminal and it appears here within 5 seconds.']);
    expect(screen.getByText('No agent')).toBeInTheDocument();
    expect(screen.queryByText('Select an agent')).toBeNull();
    expect(screen.queryByText(/J and K move/)).toBeNull();
  });

  it('names the ended sessions the filter hides when nothing is alive', () => {
    stubFetch();
    render(
      <Page>
        <AgentWorkspace sessions={[]} hiddenDead={2} />
      </Page>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('No session is alive. 2 ended sessions are hidden: choose "Alive and ended sessions" in the filter above to see them.');
  });

  it('has a slim toolbar: the title, the count, a filter that writes the show URL parameter, and the shortcut help', () => {
    stubFetch();
    render(
      <Page>
        <AgentWorkspace sessions={[SHOP, DOCS]} hiddenDead={3} />
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
        <AgentWorkspace sessions={[SHOP, DOCS]} />
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
        <AgentWorkspace sessions={[SHOP, DOCS]} />
      </Page>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Pin' }));
    await expectNoticeDetails(/Could not pin the session: state file is not valid JSON. Fix or delete it./);
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
        <AgentWorkspace sessions={[SHOP, DOCS]} />
      </Page>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Pin' }));
    expect(await screen.findByRole('button', { name: 'Pinned, 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unpin' })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'p' });
    expect(await screen.findByRole('button', { name: 'Pin' })).toBeInTheDocument();
  });

  it('shows the pins error of the page answer', async () => {
    stubFetch();
    render(
      <Page>
        <AgentWorkspace sessions={[SHOP]} userStateError="agents-user-state.json is not valid JSON. Fix or delete it." />
      </Page>,
    );
    expect(screen.queryByText('Pins and seen markers unavailable')).toBeNull();
    await expectNoticeDetails(/agents-user-state.json is not valid JSON. Fix or delete it./);
  });

  it('says so when the selected session is not in the list, and can close it', async () => {
    stubFetch();
    render(
      <Page initial={{ session: 'ffffffff-0000-4000-8000-000000000000' }}>
        <AgentWorkspace sessions={[SHOP]} />
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
        <AgentWorkspace sessions={[SHOP]} />
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
          <AgentWorkspace sessions={[done]} />
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
  it('failureText reads both error shapes and falls back to the status', () => {
    expect(failureText({ error: 'BAD_REQUEST', message: 'bad id', hint: 'use a uuid' }, 400)).toBe('bad id. use a uuid');
    expect(failureText({ ok: false, error: { code: 'c', message: 'gone', hint: 'wait' } }, 404)).toBe('gone. wait');
    expect(failureText({ errorText: 'one line' }, 200)).toBe('one line');
    expect(failureText(null, 502)).toContain('HTTP 502');
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

  it('stacks on a narrow screen: the list hides when a session is open', () => {
    const { container } = render(<SplitPane list={<div>list</div>} detail={<div>detail</div>} detailOpen />);
    expect(container.querySelector('[data-pane=list]')?.className).toContain('hidden lg:flex');
    expect(container.querySelector('[data-pane=detail]')?.className).toContain('flex');
  });
});

describe('SplitPane width on a wide screen', () => {
  it('grows with the workspace (22 %, between 300 and 640 px) until the user chooses', async () => {
    const { autoListWidth, AUTO_LIST_SHARE } = await import('../ui/SplitPane.js');
    expect(AUTO_LIST_SHARE).toBe(0.22);
    expect(autoListWidth(1200)).toBe(300);
    expect(autoListWidth(1680)).toBe(370);
    expect(autoListWidth(2320)).toBe(510);
    expect(autoListWidth(9000)).toBe(MAX_LIST_WIDTH);
    expect(autoListWidth(0)).toBe(DEFAULT_LIST_WIDTH);
  });

  it('keeps the detail pane at least 55 % of the workspace when the width is known', () => {
    expect(clampWidth(900, 1200)).toBe(540);
    expect(clampWidth(900, 0)).toBe(MAX_LIST_WIDTH);
  });
});

describe('SplitPane saved width and dragging', () => {
  const KEY = 'agent-manager.listWidth.v2';
  let restore: (() => void) | undefined;

  function stubWorkspaceWidth(px: number): void {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => px });
    restore = () => {
      if (original !== undefined) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', original);
      } else {
        delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
      }
    };
  }
  afterEach(() => {
    restore?.();
    restore = undefined;
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it('shows a saved 640 px as 540 px (45 %) on a 1200 px workspace, and merely opening does not rewrite the saved value', () => {
    window.localStorage.setItem(KEY, '640');
    stubWorkspaceWidth(1200);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    render(<SplitPane list={<div>list</div>} detail={<div>detail</div>} detailOpen={false} />);
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '540');
    expect(window.localStorage.getItem(KEY)).toBe('640');
    expect(setItem).not.toHaveBeenCalled();
  });

  it('starts a key step from the width that is shown, and that step is then the saved choice', () => {
    window.localStorage.setItem(KEY, '640');
    stubWorkspaceWidth(1200);
    render(<SplitPane list={<div>list</div>} detail={<div>detail</div>} detailOpen={false} />);
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowLeft' });
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '524');
    expect(window.localStorage.getItem(KEY)).toBe('524');
  });

  it('shows the automatic width until the user chooses, without saving it', () => {
    stubWorkspaceWidth(2320);
    render(<SplitPane list={<div>list</div>} detail={<div>detail</div>} detailOpen={false} />);
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '510');
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('follows the pointer while dragging but saves once, when the pointer is released', () => {
    stubWorkspaceWidth(2000);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    render(<SplitPane list={<div>list</div>} detail={<div>detail</div>} detailOpen={false} />);
    const separator = screen.getByRole('separator');
    separator.setPointerCapture = () => undefined;
    const start = Number(separator.getAttribute('aria-valuenow'));
    fireEvent.pointerDown(separator, { clientX: 400, pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 430, pointerId: 1 });
    fireEvent.pointerMove(separator, { clientX: 460, pointerId: 1 });
    expect(separator).toHaveAttribute('aria-valuenow', String(start + 60));
    expect(setItem).not.toHaveBeenCalled();
    fireEvent.pointerUp(separator, { pointerId: 1 });
    expect(setItem).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(KEY)).toBe(String(start + 60));
    expect(separator).toHaveAttribute('aria-valuenow', String(start + 60));
  });
});

// The layout menu is ONE icon button with a fixed name; this opens it and picks a layout.
const LAYOUT_BUTTON = 'List layout and view options';
// The layout menu is ONE fixed icon: the current layout is the checked item inside its popup (opened, read, closed again).
const expectLayout = (name: string): void => {
  fireEvent.click(screen.getByRole('button', { name: LAYOUT_BUTTON }));
  expect(screen.getByRole('radio', { name: new RegExp('^' + name) })).toHaveAttribute('aria-checked', 'true');
  fireEvent.keyDown(document, { key: 'Escape' });
};
const pickMode = (name: string): void => {
  fireEvent.click(screen.getByRole('button', { name: LAYOUT_BUTTON }));
  fireEvent.click(screen.getByRole('radio', { name: new RegExp(`^${name}`) }));
};

describe('the listing mode', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('is Tree by default, the toggle switches it, and the choice is in the URL and remembered', () => {
    stubFetch();
    render(
      <Page initial={{ mode: '' }}>
        <AgentWorkspace sessions={[SHOP, DOCS]} />
      </Page>,
    );
    expectLayout('Tree');
    expect(screen.getByRole('tree', { name: 'Agents by folder' })).toBeInTheDocument();
    pickMode('Inbox');
    expect(screen.getByTestId('mode').textContent).toBe('inbox');
    expect(window.localStorage.getItem(MODE_STORAGE_KEY)).toBe('inbox');
    expect(screen.getByRole('tablist', { name: 'Inbox' })).toBeInTheDocument();
    // Q6: the four tabs share the strip; none is cut by a hidden sideways scroll.
    expect(screen.getByRole('tablist', { name: 'Inbox' }).className).not.toContain('overflow-x');
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab.className).toContain('flex-wrap');
    }
    pickMode('Groups');
    expect(screen.getByRole('listbox', { name: 'Agents' })).toBeInTheDocument();
  });

  it('is ONE icon button with a menu of the four modes, moved with the arrow keys and picked with Enter', () => {
    stubFetch();
    render(
      <Page initial={{ mode: 'tree' }}>
        <AgentWorkspace sessions={[SHOP]} />
      </Page>,
    );
    expect(screen.queryByRole('radiogroup', { name: 'Listing mode' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Tree' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: LAYOUT_BUTTON }));
    expect(within(screen.getByRole('radiogroup', { name: 'Layout' })).getAllByRole('radio')).toHaveLength(4);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(screen.getByTestId('mode').textContent).toBe('groups');
    expectLayout('Groups');
  });

  it('uses the saved mode when the address has none', () => {
    stubFetch();
    window.localStorage.setItem(MODE_STORAGE_KEY, 'inbox');
    render(
      <Page initial={{ mode: '' }}>
        <AgentWorkspace sessions={[SHOP]} />
      </Page>,
    );
    expectLayout('Inbox');
  });

  it('says so when the address names a mode that does not exist, shows Tree, and can remove it from the address', async () => {
    stubFetch();
    window.localStorage.setItem(MODE_STORAGE_KEY, 'inbox');
    render(
      <Page initial={{ mode: 'cards' }}>
        <AgentWorkspace sessions={[SHOP]} />
      </Page>,
    );
    await expectNoticeDetails(/asks for the mode 'cards', which does not exist. Showing Tree/);
    expect(screen.getByRole('tree', { name: 'Agents by folder' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove it from the address' }));
    expect(screen.getByTestId('mode').textContent).toBe('');
  });

  it('has no link to the table page in the toolbar (the table is reached from the side menu)', () => {
    stubFetch();
    render(
      <Page>
        <AgentWorkspace sessions={[SHOP]} />
      </Page>,
    );
    expect(screen.queryByRole('link', { name: /table/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /table/i })).toBeNull();
  });
});

describe('the search, in every mode', () => {
  const SHOPS = [row({ folder: 'shop', displayName: 'shop-owner', cwd: '/w/shop', state: 'needs-you', reason: 'permission prompt' }), row({ folder: 'docs', displayName: 'docs-writer', cwd: '/w/docs', state: 'idle', lastActivity: 'Edit: README' }), row({ folder: 'api', displayName: 'api-owner', cwd: '/w/api', state: 'working' })];
  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it.each([
    ['tree', 'tree'],
    ['groups', 'listbox'],
    ['inbox', 'listbox'],
  ] as const)('filters the rows in %s, highlights the letters, and says "N of M"', (mode, role) => {
    stubFetch();
    const { container } = render(
      <Page initial={{ mode, tab: 'all' }}>
        <AgentWorkspace sessions={SHOPS} />
      </Page>,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Search agents' }), { target: { value: 'doc' } });
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
    expect(within(screen.getByRole(role === 'tree' ? 'tree' : 'listbox')).getAllByRole(role === 'tree' ? 'treeitem' : 'option').filter((item) => item.hasAttribute('data-session-id'))).toHaveLength(1);
    expect(container.querySelectorAll('[data-match]').length).toBeGreaterThan(0);
  });

  it('tree: keeps the folder of every match and drops the folders without one', () => {
    stubFetch();
    render(
      <Page initial={{ mode: 'tree' }}>
        <AgentWorkspace sessions={SHOPS} />
      </Page>,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Search agents' }), { target: { value: 'api' } });
    const folders = screen.getAllByRole('treeitem').filter((item) => !item.hasAttribute('data-session-id'));
    expect(folders).toHaveLength(1);
    expect(folders[0]).toHaveTextContent('api');
  });

  it('groups: hides the groups without a match', () => {
    stubFetch();
    render(
      <Page initial={{ mode: 'groups' }}>
        <AgentWorkspace sessions={SHOPS} />
      </Page>,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Search agents' }), { target: { value: 'state:working' } });
    expect(screen.getAllByRole('group')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Working, 1' })).toBeInTheDocument();
  });

  it('matches the last activity text too', () => {
    stubFetch();
    render(
      <Page>
        <AgentWorkspace sessions={SHOPS} />
      </Page>,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Search agents' }), { target: { value: 'README' } });
    expect(screen.getByText('1 of 3')).toBeInTheDocument();
  });

  it('an empty result is explicit, with the way out, and a typo in a prefix is reported', () => {
    stubFetch();
    render(
      <Page>
        <AgentWorkspace sessions={SHOPS} />
      </Page>,
    );
    const box = screen.getByRole('textbox', { name: 'Search agents' });
    fireEvent.change(box, { target: { value: 'zzzz' } });
    expect(screen.getByText("No agent matches 'zzzz'")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear the search' }));
    expect((box as HTMLInputElement).value).toBe('');
    fireEvent.change(box, { target: { value: 'state:nope' } });
    expect(screen.getAllByText(/'nope' is not a state/).length).toBeGreaterThan(0);
  });

  it('the / shortcut focuses the box, ArrowDown moves the selection, Enter goes to the reply box, Escape clears then leaves', async () => {
    stubFetch();
    render(
      <Page>
        <AgentWorkspace sessions={SHOPS} />
      </Page>,
    );
    fireEvent.keyDown(document.body, { key: '/' });
    const box = screen.getByRole('textbox', { name: 'Search agents' });
    expect(box).toHaveFocus();
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(screen.getByTestId('url').textContent).not.toBe('');
    const composerShown = await screen.findByRole('textbox', { name: /^Message to / });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(composerShown).toHaveFocus();
    box.focus();
    fireEvent.change(box, { target: { value: 'abc' } });
    fireEvent.keyDown(box, { key: 'Escape' });
    expect((box as HTMLInputElement).value).toBe('');
    expect(box).toHaveFocus();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(box).not.toHaveFocus();
  });
});

describe('the view options', () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });
  const WITH_ACTIVITY = [row({ folder: 'task', displayName: 'task-owner', state: 'working', lastActivity: 'Bash: npm test' })];

  it('groups: the last activity line is an option (on by default), remembered', () => {
    stubFetch();
    render(
      <Page>
        <AgentWorkspace sessions={WITH_ACTIVITY} />
      </Page>,
    );
    expect(screen.getByText('Bash: npm test')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: LAYOUT_BUTTON }));
    fireEvent.click(screen.getByRole('switch', { name: /Show the last activity/ }));
    expect(screen.queryByText('Bash: npm test')).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(VIEW_OPTIONS_STORAGE_KEY) ?? '{}')).toMatchObject({ groups: { preview: false } });
  });

  it('tree: grouping and expansion are options with the default By workspace and All expanded', () => {
    stubFetch();
    render(
      <Page initial={{ mode: 'tree' }}>
        <AgentWorkspace sessions={WITH_ACTIVITY} />
      </Page>,
    );
    fireEvent.click(screen.getByRole('button', { name: LAYOUT_BUTTON }));
    expect(screen.getByRole('radio', { name: /By workspace/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /All expanded/ })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: /^None/ }));
    expect(screen.getByRole('tree', { name: 'Agents' })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(VIEW_OPTIONS_STORAGE_KEY) ?? '{}')).toMatchObject({ tree: { grouping: 'none' } });
  });

  it('inbox: auto-next is off by default and explains itself', () => {
    stubFetch();
    render(
      <Page initial={{ mode: 'inbox' }}>
        <AgentWorkspace sessions={WITH_ACTIVITY} />
      </Page>,
    );
    fireEvent.click(screen.getByRole('button', { name: LAYOUT_BUTTON }));
    const toggle = screen.getByRole('switch', { name: /Open the next agent after a reply/ });
    expect(toggle).not.toBeChecked();
    expect(screen.getByText(/stops needing you, the next one that does opens by itself/)).toBeInTheDocument();
  });
});

describe('the search box walks the data, not the DOM', () => {
  const FOLDERS = [row({ folder: 'shop', displayName: 'shop-owner', cwd: '/w/shop', state: 'needs-you', reason: 'permission prompt' }), row({ folder: 'docs', displayName: 'docs-writer', cwd: '/w/docs', state: 'idle', lastActivity: 'Edit: README' }), row({ folder: 'docs', displayName: 'docs-reviewer', cwd: '/w/docs', state: 'idle', lastActivity: 'Read: README' })];
  afterEach(() => {
    window.localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('tree: a folder closed by hand opens while searching, so its matches are listed and reached with the arrows', async () => {
    stubFetch();
    render(
      <Page initial={{ mode: 'tree' }}>
        <AgentWorkspace sessions={FOLDERS} />
      </Page>,
    );
    // Close the docs folder by hand: its sessions leave the list.
    fireEvent.click(screen.getAllByRole('treeitem').find((item) => item.textContent?.includes('docs') === true && !item.hasAttribute('data-session-id'))!);
    expect(screen.queryByText('docs-writer')).toBeNull();
    const box = screen.getByRole('textbox', { name: 'Search agents' });
    fireEvent.change(box, { target: { value: 'README' } });
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    // Both matches are listed (the highlight splits the name, so the rows are counted) and the arrows reach both.
    expect(screen.getAllByRole('treeitem').filter((item) => item.hasAttribute('data-session-id'))).toHaveLength(2);
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    const first = screen.getByTestId('url').textContent;
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    const second = screen.getByTestId('url').textContent;
    expect(first).not.toBe('');
    expect(second).not.toBe(first);
  });

  it('Enter selects the first match and the reply box takes the focus once it is there, from no selection at all', async () => {
    stubFetch();
    render(
      <Page initial={{ mode: 'groups' }}>
        <AgentWorkspace sessions={FOLDERS} />
      </Page>,
    );
    const box = screen.getByRole('textbox', { name: 'Search agents' });
    box.focus();
    fireEvent.change(box, { target: { value: 'shop' } });
    expect(screen.getByTestId('url').textContent).toBe('');
    fireEvent.keyDown(box, { key: 'Enter' });
    const composer = await screen.findByRole('textbox', { name: /^Message to / });
    await waitFor(() => expect(composer).toHaveFocus());
  });

  it('says so when the reply box cannot take the focus (the session cannot receive messages)', async () => {
    stubFetch(undefined, statusFixture({ transportAvailable: false }));
    render(
      <Page initial={{ mode: 'groups' }}>
        <AgentWorkspace sessions={FOLDERS} />
      </Page>,
    );
    const box = screen.getByRole('textbox', { name: 'Search agents' });
    fireEvent.change(box, { target: { value: 'shop' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await expectNoticeDetails(/cannot take the focus because the session cannot receive messages/);
  });

  it('inbox: matches that are all in another tab are said, Enter never does nothing silently', async () => {
    stubFetch();
    render(
      <Page initial={{ mode: 'inbox', tab: 'needs-you' }}>
        <AgentWorkspace sessions={FOLDERS} />
      </Page>,
    );
    const box = screen.getByRole('textbox', { name: 'Search agents' });
    fireEvent.change(box, { target: { value: 'README' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await expectNoticeDetails(/2 agents match, none in the list you are looking at/);
    expect(screen.getByTestId('url').textContent).toBe('');
    fireEvent.click(screen.getByRole('button', { name: /^Dismiss: / }));
    expect(screen.queryByText(/none in the list you are looking at/)).toBeNull();
  });
});
