import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocateResponse, LogResponse, SubagentDto } from '../deps.js';
import { row } from '../deps.js';
import { resetPending } from '../pending.js';
import { answer, assistantText, subagent, toolCall } from './entryFixtures.js';
import { LogViewer } from './LogViewer.js';
import type { SubagentsContent, SubagentsLayout } from './subagentTypes.js';

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

function show(layout: SubagentsLayout, content: SubagentsContent = 'summary') {
  return render(<LogViewer session={session} subagentsLayout={layout} subagentsContent={content} />);
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
});

const fleet: SubagentDto[] = [
  subagent({ agentId: 'run00001', description: 'builder', status: 'active', finished: false, toolUseId: 'call-run' }),
  subagent({ agentId: 'bad00001', description: 'migrator', status: 'failed', failureReason: 'Stopped by the user', toolUseId: 'call-bad' }),
  subagent({ agentId: 'ok000001', description: 'explorer', agentType: 'Explore', toolUseId: 'call-ok' }),
];

describe('sub-agent layouts', () => {
  it('panel on a wide window: an always-open complementary region with the sub-agents', async () => {
    setWide(true);
    serve({ tail: answer([assistantText('a', 'text')], { subagents: fleet }) });
    show('panel');
    const panel = await screen.findByRole('complementary', { name: 'Sub-agents' });
    expect(within(panel).getByRole('button', { name: /builder/ })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: /migrator/ })).toHaveTextContent('Stopped by the user');
  });

  it('panel on a narrow window falls back to the collapsed strip, never to nothing', async () => {
    setWide(false);
    serve({ tail: answer([assistantText('a', 'text')], { subagents: fleet }) });
    show('panel');
    const strip = await screen.findByRole('button', { name: /3 sub-agents/ });
    expect(screen.queryByRole('complementary', { name: 'Sub-agents' })).toBeNull();
    expect(strip).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(strip);
    expect(strip).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /builder/ })).toBeInTheDocument();
  });

  it('badge: opens a dialog, Escape closes it and returns the focus to the badge, choosing closes it', async () => {
    setWide(true);
    serve({ tail: answer([assistantText('a', 'text')], { subagents: fleet }) });
    show('badge');
    const badge = await screen.findByRole('button', { name: /3 sub-agents/ });
    expect(badge).toHaveAttribute('aria-haspopup', 'dialog');
    expect(screen.queryByRole('complementary')).toBeNull();
    fireEvent.click(badge);
    const dialog = screen.getByRole('dialog', { name: 'Sub-agents' });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(badge);
    fireEvent.click(badge);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /builder/ }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(dialog).not.toBeNull();
  });

  it('shows the note about the sub-agents folder even when there is no sub-agent', async () => {
    setWide(true);
    serve({ tail: answer([assistantText('a', 'text')], { subagentsNote: 'The sub-agents folder could not be read.' }) });
    show('panel');
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
    show('panel', 'summary');
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
    show('panel', 'summary');
    const panel = await screen.findByRole('complementary', { name: 'Sub-agents' });
    fireEvent.click(within(panel).getByRole('button', { name: /^Failed/ }));
    expect(within(panel).getByRole('button', { name: /migrator/ })).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: /builder/ })).toBeNull();
  });

  it('groups: one group per agent type with its count', async () => {
    setWide(true);
    serve({ tail: answer([assistantText('a', 'text')], { subagents: many }) });
    show('panel', 'groups');
    const panel = await screen.findByRole('complementary', { name: 'Sub-agents' });
    expect(within(panel).getByText('Explore')).toBeInTheDocument();
    expect(within(panel).getByText('code-reviewer')).toBeInTheDocument();
  });

  it('timeline: one row per sub-agent with a start, a title and a duration', async () => {
    setWide(true);
    serve({ tail: answer([assistantText('a', 'text')], { subagents: many }) });
    show('panel', 'timeline');
    const panel = await screen.findByRole('complementary', { name: 'Sub-agents' });
    expect(within(panel).getByRole('button', { name: 'worker 51sFinished' })).toBeInTheDocument();
    expect(within(panel).getByText(/up to \d+ at once/)).toBeInTheDocument();
  });

  it('a sub-agent whose call failed counts as failed whatever its own status says', async () => {
    setWide(true);
    serve({ tail: answer([toolCall('call-ok', { name: 'Agent', status: 'error' })], { subagents: [subagent({ agentId: 'ok000001', description: 'explorer', toolUseId: 'call-ok' })] }) });
    show('panel');
    const panel = await screen.findByRole('complementary', { name: 'Sub-agents' });
    expect(within(panel).getByRole('button', { name: /explorer/ })).toHaveTextContent('Failed');
  });
});

describe('clicking a sub-agent shows the call that started it', () => {
  const agent = subagent({ agentId: 'far00001', description: 'far worker', toolUseId: 'call-far', status: 'active', finished: false });

  it('loaded: scrolls to it, highlights it and says so, without any request', async () => {
    setWide(true);
    serve({ tail: answer([toolCall('call-far', { name: 'Agent', status: 'ok', subagentId: 'far00001', offset: 500 })], { subagents: [agent] }) });
    show('panel');
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
    show('panel');
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
    show('panel');
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
    show('panel');
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
    show('panel');
    fireEvent.click(await screen.findByRole('button', { name: /far worker/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await act(async () => release(located(100, 'call-far')));
    expect(await screen.findByText(/was cancelled before it reached it/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search older entries' })).toBeInTheDocument();
  });

  it('a failing route is an error banner with Try again, not silence', async () => {
    setWide(true);
    serve({ tail: answer([assistantText('a', 'text')], { subagents: [agent] }), locate: () => ({ ok: false, error: { code: 'unreadable', message: 'The transcript could not be read.', hint: 'Check the permissions of the file.' } }) as LocateResponse });
    show('panel');
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
    show('panel');
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
    show('panel');
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
    show('panel');
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
    show('panel');
    fireEvent.click(await screen.findByRole('button', { name: /far worker/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await act(async () => fail(new Error('connection reset')));
    expect(await screen.findByText(/connection reset/)).toBeInTheDocument();
    expect(screen.queryByText(/was cancelled before it reached it/)).toBeNull();
  });
});
