import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocateResponse, LogResponse, SubagentDto } from '../deps.js';
import { row } from '../deps.js';
import { resetPending } from '../pending.js';
import { answer, assistantText, subagent, toolCall } from './entryFixtures.js';
import { LogViewer } from './LogViewer.js';
import { SUBAGENT_PREFS_KEY } from './subagentPrefs.js';

const session = row({ displayName: 'shop-owner' });

function json(body: unknown, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

/** A handler per route: the log (tail, then older pages by cursor) and the locate route. */
interface Routes {
  tail: LogResponse;
  /** Older pages by the `before` cursor they answer. */
  older?: Record<string, LogResponse>;
  locate?: (toolUseId: string) => LocateResponse | Promise<LocateResponse>;
}

let urls: string[];

function serve(routes: Routes): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { signal?: AbortSignal }) => {
      urls.push(url);
      if (url.includes('/log/locate')) {
        const id = new URL(url, 'http://x').searchParams.get('toolUseId') ?? '';
        return json(await (routes.locate?.(id) ?? Promise.reject(new Error('no locate handler'))));
      }
      const before = new URL(url, 'http://x').searchParams.get('before');
      if (before !== null) {
        const page = routes.older?.[before];
        if (page === undefined) {
          throw new Error(`no older page for ${before}`);
        }
        return json(page);
      }
      if (init?.signal?.aborted === true) {
        throw new Error('aborted');
      }
      return json(routes.tail);
    }),
  );
}

function setWide(wide: boolean): void {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: wide, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
}

function show(mode: 'summary' | 'timeline' = 'summary') {
  if (mode === 'timeline') {
    window.localStorage.setItem(SUBAGENT_PREFS_KEY, JSON.stringify({ mode }));
  }
  return render(<LogViewer session={session} />);
}

const located = (offset: number | undefined, toolUseId = 'call-x'): LocateResponse => ({ ok: true, sessionId: 's', toolUseId, found: offset !== undefined, ...(offset === undefined ? {} : { offset }), transcriptBytes: 1000 });

beforeEach(() => {
  urls = [];
  resetPending();
  Element.prototype.scrollIntoView = vi.fn();
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0)) as typeof window.requestAnimationFrame;
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const fleet: SubagentDto[] = [
  subagent({ agentId: 'run00001', description: 'builder', status: 'active', finished: false, toolUseId: 'call-run' }),
  subagent({ agentId: 'bad00001', description: 'migrator', status: 'failed', failureReason: 'Stopped by the user', toolUseId: 'call-bad' }),
  subagent({ agentId: 'ok000001', description: 'explorer', agentType: 'Explore', toolUseId: 'call-ok' }),
];

describe('the sub-agent side panel', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('wide window: open by default, a complementary region with the sub-agents', async () => {
    setWide(true);
    serve({ tail: answer([assistantText('a', 'text')], { subagents: fleet }) });
    show();
    const panel = await screen.findByRole('complementary', { name: 'Sub-agents' });
    expect(within(panel).getByRole('button', { name: /builder/ })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /migrator/ })).toHaveTextContent('Stopped by the user');
    expect(within(panel).getByRole('button', { name: 'Collapse the sub-agents panel' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('narrow window: collapsed by default into a rail that keeps the count and the active and failed counts, never invisible', async () => {
    setWide(false);
    serve({ tail: answer([assistantText('a', 'text')], { subagents: fleet }) });
    show();
    const rail = await screen.findByRole('complementary', { name: 'Sub-agents' });
    expect(within(rail).queryByRole('button', { name: /builder/ })).toBeNull();
    expect(within(rail).getByText('3')).toBeInTheDocument();
    expect(within(rail).getByLabelText('1 active')).toBeInTheDocument();
    expect(within(rail).getByLabelText('1 failed')).toBeInTheDocument();
    fireEvent.click(within(rail).getByRole('button', { name: /^Show the sub-agents panel/ }));
    expect(within(screen.getByRole('complementary', { name: 'Sub-agents' })).getByRole('button', { name: /builder/ })).toBeInTheDocument();
  });

  it('remembers the choice: a collapsed panel stays collapsed after a remount, even on a wide window', async () => {
    setWide(true);
    serve({ tail: answer([assistantText('a', 'text')], { subagents: fleet }) });
    const first = show();
    fireEvent.click(await screen.findByRole('button', { name: 'Collapse the sub-agents panel' }));
    expect(screen.queryByRole('button', { name: /builder/ })).toBeNull();
    first.unmount();
    show();
    expect(await screen.findByRole('button', { name: /^Show the sub-agents panel/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /builder/ })).toBeNull();
  });

  it('shows the note about the sub-agents folder even when there is no sub-agent', async () => {
    setWide(true);
    serve({ tail: answer([assistantText('a', 'text')], { subagentsNote: 'The sub-agents folder could not be read.' }) });
    show();
    expect(await screen.findByText('The sub-agents folder could not be read.')).toBeInTheDocument();
  });
});

describe('sub-agent contents', () => {
  const many: SubagentDto[] = [
    subagent({ agentId: 'run00001', description: 'builder', status: 'active', finished: false }),
    subagent({ agentId: 'bad00001', description: 'migrator', status: 'failed' }),
    ...Array.from({ length: 60 }, (_, index) => subagent({ agentId: `fin${String(index).padStart(5, '0')}`, description: `worker ${index}`, agentType: index % 2 === 0 ? 'Explore' : 'code-reviewer', startedAt: 1_000 + index * 1000, endedAt: 2_000 + index * 1000 })),
  ];

  it('summary: running and failed first, the finished ones folded and capped with a way to show all', async () => {
    setWide(true);
    serve({ tail: answer([assistantText('a', 'text')], { subagents: many }) });
    show();
    const panel = await screen.findByRole('complementary', { name: 'Sub-agents' });
    expect(within(panel).getByRole('button', { name: /builder/ })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /migrator/ })).toBeInTheDocument();
    const workers = (): number => within(panel).queryAllByRole('button', { name: /^worker [0-9]/ }).length;
    expect(workers()).toBe(0);
    fireEvent.click(within(panel).getByRole('button', { name: /60 finished/ }));
    // Capped: a page of rows, not 60 at once.
    expect(workers()).toBe(40);
    fireEvent.click(within(panel).getByRole('button', { name: /Show all/ }));
    expect(workers()).toBe(60);
  });

  it('the status filter keeps only the chosen status', async () => {
    setWide(true);
    serve({ tail: answer([assistantText('a', 'text')], { subagents: many }) });
    show();
    const panel = await screen.findByRole('complementary', { name: 'Sub-agents' });
    fireEvent.click(within(panel).getByRole('button', { name: /^Failed/ }));
    expect(within(panel).getByRole('button', { name: /migrator/ })).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: /builder/ })).toBeNull();
  });

  it('timeline: one row per sub-agent with a start, a title and a duration', async () => {
    setWide(true);
    serve({ tail: answer([assistantText('a', 'text')], { subagents: many }) });
    show('timeline');
    const panel = await screen.findByRole('complementary', { name: 'Sub-agents' });
    expect(within(panel).getByRole('button', { name: 'worker 51sFinished' })).toBeInTheDocument();
    expect(within(panel).getByText(/up to \d+ at once/)).toBeInTheDocument();
  });

  it('a sub-agent whose call failed counts as failed whatever its own status says', async () => {
    setWide(true);
    serve({ tail: answer([toolCall('call-ok', { name: 'Agent', status: 'error' })], { subagents: [subagent({ agentId: 'ok000001', description: 'explorer', toolUseId: 'call-ok' })] }) });
    show();
    const panel = await screen.findByRole('complementary', { name: 'Sub-agents' });
    expect(within(panel).getByRole('button', { name: /explorer/ })).toHaveTextContent('Failed');
  });
});

describe('clicking a sub-agent shows the call that started it', () => {
  const agent = subagent({ agentId: 'far00001', description: 'far worker', toolUseId: 'call-far', status: 'active', finished: false });

  it('loaded: scrolls to it, highlights it and says so, without any request', async () => {
    setWide(true);
    serve({ tail: answer([toolCall('call-far', { name: 'Agent', status: 'ok', subagentId: 'far00001', offset: 500 })], { subagents: [agent] }) });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /far worker/ }));
    await waitFor(() => expect(document.querySelector('[data-hot="true"]')).not.toBeNull());
    expect(screen.getByRole('button', { name: /far worker/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /far worker/ })).toHaveTextContent('Showing the call');
    expect(document.querySelector('p[aria-live="polite"]')).toHaveTextContent('Showing the call that started far worker');
    expect(urls.some((url) => url.includes('/log/locate'))).toBe(false);
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    // The line stays (persistent) until it is cleared.
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText(/Showing the call that started/)).toBeNull();
  });

  it('far back: shows the search with progress and Cancel at once, loads older pages, then shows and highlights the call', async () => {
    setWide(true);
    let release: (value: LocateResponse) => void = () => undefined;
    const gate = new Promise<LocateResponse>((resolve) => (release = resolve));
    serve({
      tail: answer([assistantText('new', 'recent', 9_000)].map((entry) => ({ ...entry, offset: 9000 })), { subagents: [agent], olderCursor: 'o1' }),
      older: {
        o1: answer([{ ...assistantText('mid', 'middle'), offset: 5000 }], { olderCursor: 'o2' }),
        o2: answer([{ ...toolCall('call-far', { name: 'Agent', status: 'ok', subagentId: 'far00001' }), offset: 100 }], { olderCursor: null }),
      },
      locate: () => gate,
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /far worker/ }));
    // Visible before the route answers.
    const status = await screen.findByText(/Looking for the call that started "far worker"/);
    expect(status).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Search for the call' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    await act(async () => release(located(100, 'call-far')));
    await waitFor(() => expect(document.querySelector('[data-hot="true"]')).not.toBeNull());
    expect(urls.filter((url) => url.includes('before=')).length).toBe(2);
    expect(screen.getByRole('button', { name: /far worker/ })).toHaveTextContent('Showing the call');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('not in the transcript: a visible banner that says what happened, with Dismiss, and the row says "Call not found"', async () => {
    setWide(true);
    serve({ tail: answer([assistantText('a', 'text')], { subagents: [agent] }), locate: () => located(undefined, 'call-far') });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /far worker/ }));
    expect(await screen.findByText(/Call not shown/)).toBeInTheDocument();
    expect(screen.getByText(/No line of this session's transcript holds the call/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /far worker/ })).toHaveTextContent('Call not found');
    expect(screen.getByRole('button', { name: /far worker/ })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('[data-hot="true"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/Call not shown/)).toBeNull();
  });

  it('a sub-agent started by name has no call: says so, never a silent no-op', async () => {
    setWide(true);
    serve({ tail: answer([assistantText('a', 'text')], { subagents: [subagent({ agentId: 'nm000001', description: 'named one', status: 'active', finished: false })] }) });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /named one/ }));
    expect(await screen.findByText(/has no recorded originating call/)).toBeInTheDocument();
    expect(urls.some((url) => url.includes('/log/locate'))).toBe(false);
  });

  it('Cancel stops the search and offers to search again', async () => {
    setWide(true);
    let release: (value: LocateResponse) => void = () => undefined;
    const gate = new Promise<LocateResponse>((resolve) => (release = resolve));
    serve({
      tail: answer([{ ...assistantText('new', 'recent'), offset: 9000 }], { subagents: [agent], olderCursor: 'o1' }),
      older: { o1: answer([{ ...assistantText('mid', 'middle'), offset: 5000 }], { olderCursor: 'o2' }) },
      // The route answers only when the test lets it: the search is still running when Cancel is pressed.
      locate: () => gate,
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /far worker/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await act(async () => release(located(100, 'call-far')));
    expect(await screen.findByText(/was cancelled before it reached it/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search older entries' })).toBeInTheDocument();
  });

  it('a failing route is an error banner with Try again, not silence', async () => {
    setWide(true);
    serve({ tail: answer([assistantText('a', 'text')], { subagents: [agent] }), locate: () => ({ ok: false, error: { code: 'unreadable', message: 'The transcript could not be read.', hint: 'Check the permissions of the file.' } }) as LocateResponse });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /far worker/ }));
    expect(await screen.findByText(/The search for the call failed/)).toBeInTheDocument();
    expect(screen.getByText(/Check the permissions of the file/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /far worker/ })).toHaveTextContent('Search failed');
  });
});

describe('an active sub-agent is a guess, said as such', () => {
  it('says Active (not Running), the last activity from the client clock, and a tooltip that names the missing end marker', async () => {
    setWide(true);
    const lastActivityAt = Date.now() - 42_000;
    serve({ tail: answer([assistantText('a', 'text')], { subagents: [subagent({ agentId: 'act00001', description: 'builder', status: 'active', finished: false, startedAt: lastActivityAt - 60_000, lastActivityAt })] }) });
    show();
    const row = await screen.findByRole('button', { name: /builder/ });
    expect(row).toHaveTextContent('Active');
    expect(row).not.toHaveTextContent('Running');
    expect(row).toHaveTextContent(/last activity 4\ds ago/);
    expect(row.getAttribute('title')).toMatch(/no end marker, last activity .* ago\. Probably running/);
    expect(screen.getByText(/1 active \(no end marker\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Active 1/ })).toBeInTheDocument();
  });

  it('shows "Status unknown" with the reason for a sub-agent whose transcript could not be read, never as active', async () => {
    setWide(true);
    serve({ tail: answer([assistantText('a', 'text')], { subagents: [subagent({ agentId: 'unk00001', description: 'mystery', status: 'unknown', finished: false, readError: 'The transcript could not be read: EACCES' })] }) });
    show();
    const row = await screen.findByRole('button', { name: /mystery/ });
    expect(row).toHaveTextContent('Status unknown');
    expect(row).toHaveTextContent('EACCES');
    expect(row).not.toHaveTextContent('Active');
    expect(screen.getByText(/1 status unknown/)).toBeInTheDocument();
  });
});

describe('locating a call: honest outcomes', () => {
  const agent = subagent({ agentId: 'far00001', description: 'far worker', toolUseId: 'call-far', status: 'active', finished: false });

  it('everything is loaded and the call is still before the first held entry: says so (not "the transcript changed")', async () => {
    setWide(true);
    serve({ tail: answer([{ ...assistantText('new', 'recent'), offset: 9000 }], { subagents: [agent], olderCursor: null }), locate: () => located(100, 'call-far') });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /far worker/ }));
    expect(await screen.findByText(/not in the loaded range although the whole transcript is loaded/)).toBeInTheDocument();
    expect(screen.queryByText(/changed while searching/)).toBeNull();
    expect(urls.filter((url) => url.includes('before=')).length).toBe(0);
  });

  it('a real network failure that coincides with Cancel is shown as an error, not as "cancelled"', async () => {
    setWide(true);
    let fail: (reason: Error) => void = () => undefined;
    const gate = new Promise<LocateResponse>((_resolve, reject) => (fail = reject));
    serve({ tail: answer([{ ...assistantText('new', 'recent'), offset: 9000 }], { subagents: [agent], olderCursor: 'o1' }), locate: () => gate });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /far worker/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await act(async () => fail(new Error('connection reset')));
    expect(await screen.findByText(/connection reset/)).toBeInTheDocument();
    expect(screen.queryByText(/was cancelled before it reached it/)).toBeNull();
  });
});

describe('the view of the panel and the order', () => {
  afterEach(() => {
    window.localStorage.clear();
  });
  const NOW = Date.now();
  const timed: SubagentDto[] = [
    subagent({ agentId: 'old00001', description: 'oldest one', startedAt: NOW - 600_000, endedAt: NOW - 500_000 }),
    subagent({ agentId: 'mid00001', description: 'middle one', startedAt: NOW - 400_000, endedAt: NOW - 300_000 }),
    subagent({ agentId: 'new00001', description: 'newest one', startedAt: NOW - 200_000, endedAt: NOW - 100_000 }),
  ];
  const titles = (container: HTMLElement): string[] => within(container).getAllByRole('button', { name: /one/ }).map((button) => /(oldest|middle|newest) one/.exec(button.textContent ?? '')?.[0] ?? '');

  it('is the Summary by default, and the mode switch changes it and is remembered', async () => {
    setWide(true);
    serve({ tail: answer([assistantText('a', 'text')], { subagents: timed }) });
    const first = show();
    const panel = await screen.findByRole('complementary', { name: 'Sub-agents' });
    expect(within(panel).getByRole('button', { name: 'Summary' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(panel).queryByRole('button', { name: /Sort order/ })).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: 'Timeline' }));
    expect(within(panel).getByRole('button', { name: /Sort order/ })).toBeInTheDocument();
    first.unmount();
    show();
    const again = await screen.findByRole('complementary', { name: 'Sub-agents' });
    expect(within(again).getByRole('button', { name: 'Timeline' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('there is no By type content, no strip and no badge', async () => {
    setWide(false);
    serve({ tail: answer([assistantText('a', 'text')], { subagents: timed }) });
    show();
    await screen.findByRole('complementary', { name: 'Sub-agents' });
    expect(screen.queryByRole('button', { name: 'By type' })).toBeNull();
    expect(document.querySelector('[aria-haspopup="dialog"]')).toBeNull();
  });

  it('timeline: most recent first by default, the "now" label reverses it with an explicit name, and the choice is remembered', async () => {
    setWide(true);
    window.localStorage.setItem(SUBAGENT_PREFS_KEY, JSON.stringify({ mode: 'timeline' }));
    serve({ tail: answer([assistantText('a', 'text')], { subagents: timed }) });
    const first = show();
    const panel = await screen.findByRole('complementary', { name: 'Sub-agents' });
    expect(titles(panel)).toEqual(['newest one', 'middle one', 'oldest one']);
    const sort = within(panel).getByRole('button', { name: 'Sort order: most recent first, activate to reverse' });
    // The anchor is above the rows while the most recent is on top.
    const list = panel.querySelector('ul') as HTMLElement;
    expect(sort.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(sort);
    expect(titles(panel)).toEqual(['oldest one', 'middle one', 'newest one']);
    const reversed = within(panel).getByRole('button', { name: 'Sort order: oldest first, activate to reverse' });
    // ... and below them once the oldest is on top.
    expect(reversed.compareDocumentPosition(panel.querySelector('ul') as HTMLElement) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    first.unmount();
    show();
    const again = await screen.findByRole('complementary', { name: 'Sub-agents' });
    expect(titles(again)).toEqual(['oldest one', 'middle one', 'newest one']);
  });

  it('summary: active first, then failed, then the finished ones by most recent end time', async () => {
    setWide(true);
    const fleetByEnd = [
      subagent({ agentId: 'f1', description: 'finished early', startedAt: NOW - 900_000, endedAt: NOW - 800_000 }),
      subagent({ agentId: 'f2', description: 'finished late', startedAt: NOW - 500_000, endedAt: NOW - 50_000, lastActivityAt: NOW - 50_000 }),
      subagent({ agentId: 'b1', description: 'broke', status: 'failed', failureReason: 'Stopped by the user', startedAt: NOW - 300_000, endedAt: NOW - 250_000 }),
      subagent({ agentId: 'a1', description: 'busy', status: 'active', finished: false, startedAt: NOW - 100_000, lastActivityAt: NOW - 5_000 }),
    ];
    serve({ tail: answer([assistantText('a', 'text')], { subagents: fleetByEnd }) });
    show();
    const panel = await screen.findByRole('complementary', { name: 'Sub-agents' });
    fireEvent.click(within(panel).getByRole('button', { name: /2 finished/ }));
    const order = within(panel)
      .getAllByRole('button', { name: /busy|broke|finished (early|late)/ })
      .map((button) => /busy|broke|finished early|finished late/.exec(button.textContent ?? '')?.[0]);
    expect(order).toEqual(['busy', 'broke', 'finished late', 'finished early']);
  });
});

describe('the panel: rail, selection, one ordering rule, notes', () => {
  const NOW = Date.now();

  it('a collapsed rail has ONE accessible name for the count (singular for one) and tooltips only on the status chips', async () => {
    setWide(false);
    serve({ tail: answer([assistantText('a', 'text')], { subagents: [subagent({ agentId: 'one00001', description: 'lonely', status: 'active', finished: false, lastActivityAt: NOW })] }) });
    show();
    const rail = await screen.findByRole('complementary', { name: 'Sub-agents' });
    expect(within(rail).getByRole('button', { name: 'Show the sub-agents panel (1 sub-agent)' })).toBeInTheDocument();
    expect(within(rail).getAllByLabelText('1 active')).toHaveLength(1);
    expect(rail.querySelector('.sr-only')).toBeNull();
    expect(within(rail).queryByText('sub-agents')).toBeNull();
  });

  it('collapsing after a selection keeps the choice and the rail shows the state of the selected sub-agent', async () => {
    setWide(true);
    const agent = subagent({ agentId: 'far00001', description: 'far worker', toolUseId: 'call-far', status: 'active', finished: false });
    serve({ tail: answer([toolCall('call-far', { name: 'Agent', status: 'ok', subagentId: 'far00001', offset: 500 })], { subagents: [agent] }) });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /far worker/ }));
    await waitFor(() => expect(document.querySelector('[data-hot="true"]')).not.toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Collapse the sub-agents panel' }));
    const rail = screen.getByRole('complementary', { name: 'Sub-agents' });
    expect(within(rail).getByRole('img', { name: /Selected: far worker, active, showing its call/ })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(SUBAGENT_PREFS_KEY) ?? '{}')).toMatchObject({ collapsed: true });
  });

  it('the Summary and the Timeline order the same data by the same key: the last activity (end time first)', async () => {
    setWide(true);
    // A started first and ended last; B started last and ended first: by start they are in opposite orders, by last activity A is the most recent.
    const fleetByEnd = [
      subagent({ agentId: 'aa000001', description: 'ended last', startedAt: NOW - 900_000, endedAt: NOW - 10_000, lastActivityAt: NOW - 10_000 }),
      subagent({ agentId: 'bb000001', description: 'ended first', startedAt: NOW - 100_000, endedAt: NOW - 90_000, lastActivityAt: NOW - 90_000 }),
    ];
    serve({ tail: answer([assistantText('a', 'text')], { subagents: fleetByEnd }) });
    const first = show();
    const panel = await screen.findByRole('complementary', { name: 'Sub-agents' });
    fireEvent.click(within(panel).getByRole('button', { name: /2 finished/ }));
    const names = (): (string | undefined)[] => within(panel).getAllByRole('button', { name: /ended (first|last)/ }).map((button) => /ended (first|last)/.exec(button.textContent ?? '')?.[0]);
    expect(names()).toEqual(['ended last', 'ended first']);
    fireEvent.click(within(panel).getByRole('button', { name: 'Timeline' }));
    expect(names()).toEqual(['ended last', 'ended first']);
    fireEvent.click(within(panel).getByRole('button', { name: /Sort order/ }));
    expect(names()).toEqual(['ended first', 'ended last']);
    first.unmount();
  });

  it('the sort button says how to reverse the order, with a visible icon', async () => {
    setWide(true);
    window.localStorage.setItem(SUBAGENT_PREFS_KEY, JSON.stringify({ mode: 'timeline' }));
    serve({ tail: answer([assistantText('a', 'text')], { subagents: [subagent({ agentId: 'aa000001', description: 'one', startedAt: NOW - 60_000, endedAt: NOW - 30_000 })] }) });
    show();
    const sort = await screen.findByRole('button', { name: /Sort order/ });
    expect(sort.querySelector('svg')).not.toBeNull();
    fireEvent.focus(sort);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/Click to reverse the order/);
  });

  it('unreadable or unknown saved settings give the defaults and a visible, dismissible note, and one console warning', async () => {
    setWide(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    window.localStorage.setItem(SUBAGENT_PREFS_KEY, '{not json');
    serve({ tail: answer([assistantText('a', 'text')], { subagents: fleet }) });
    show();
    const panel = await screen.findByRole('complementary', { name: 'Sub-agents' });
    expect(within(panel).getByRole('alert')).toHaveTextContent('Your sub-agent panel settings could not be read: the defaults are used.');
    expect(within(panel).getByRole('button', { name: 'Summary' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(panel).getByRole('button', { name: 'Dismiss the note about the panel settings' }));
    expect(within(panel).queryByRole('alert')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('a failing storage is said when a choice cannot be saved, and the choice still holds', async () => {
    setWide(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    serve({ tail: answer([assistantText('a', 'text')], { subagents: fleet }) });
    show();
    const panel = await screen.findByRole('complementary', { name: 'Sub-agents' });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    fireEvent.click(within(panel).getByRole('button', { name: 'Timeline' }));
    expect(within(panel).getByRole('alert')).toHaveTextContent('could not be saved');
    expect(within(panel).getByRole('button', { name: 'Timeline' })).toHaveAttribute('aria-pressed', 'true');
    set.mockRestore();
    warn.mockRestore();
  });
});
