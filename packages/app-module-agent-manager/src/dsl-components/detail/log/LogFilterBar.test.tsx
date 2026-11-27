import { descriptionOf, focusByKeyboard, hoverTip, liveTooltip } from '../status/liveTooltip.js';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogEntry, LogResponse } from '../deps.js';
import { row } from '../deps.js';
import { resetPending } from '../pending.js';
import { answer, assistantText, toolCall, userPrompt } from './entryFixtures.js';
import { FILTER_PREFS_KEY } from './logFilters.js';
import { LogViewer } from './LogViewer.js';

const session = row({ displayName: 'shop-owner' });

function respond(body: LogResponse): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

const hook = (key: string, patch: Partial<Extract<LogEntry, { kind: 'hook' }>> = {}): LogEntry => ({ key, offset: 0, timestamp: 3_000, kind: 'hook', hookEvent: 'PreToolUse', hookName: 'PreToolUse:Bash', outcome: 'success', attachmentType: 'hook_success', durationMs: 108, ...patch });
const peer = (key: string): LogEntry => ({ ...(userPrompt(key, 'from the other session') as Extract<LogEntry, { kind: 'user-prompt' }>), source: 'peer', isMeta: true, peer: { name: 'other' } });

let entries: LogEntry[];

beforeEach(() => {
  window.localStorage.clear();
  // The bar is hidden by default: these tests are about the bar, so they ask for it (LogFilterMenu.test.tsx covers the default and the choice).
  window.localStorage.setItem(FILTER_PREFS_KEY, JSON.stringify({ bar: true }));
  resetPending();
  Element.prototype.scrollIntoView = vi.fn();
  entries = [userPrompt('u', 'run the tests'), toolCall('a', { status: 'ok', resultPreview: 'one' }), hook('h1'), hook('h2', { outcome: 'error', exitCode: 1, stderr: 'bad json' }), assistantText('mid', 'between'), toolCall('b', { status: 'ok', name: 'SendMessage', inputSummary: 'worker' }), peer('p'), assistantText('z', 'done')];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => respond(answer(entries))),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const filter = (name: string): HTMLElement => document.querySelector(`[data-filter="${name}"]`) as HTMLElement;

describe('log filters', () => {
  it('starts with hooks hidden, tools and agent messages shown, counts on the toggles, and a marker for what is hidden', async () => {
    render(<LogViewer session={session} />);
    expect(await screen.findByText('run the tests')).toBeInTheDocument();
    expect(filter('hooks')).toHaveAttribute('aria-pressed', 'false');
    expect(filter('tools')).toHaveAttribute('aria-pressed', 'true');
    expect(filter('agents')).toHaveAttribute('aria-pressed', 'true');
    expect(filter('hooks')).toHaveTextContent('Hooks 2');
    expect(filter('tools')).toHaveTextContent('Tools 1');
    expect(filter('agents')).toHaveTextContent('Agent messages 2');
    expect(screen.queryByText('Hook')).toBeNull();
    hoverTip(screen.getByText('2 hidden'));
    expect(liveTooltip().textContent).toBe('Hidden by the filters: 2 hooks');
    // Not hidden: the lone tool call (a row of its own, not a group: the SendMessage is an agent message), the message of the other session.
    expect(screen.getByRole('button', { name: /^Bash/ })).toBeInTheDocument();
    expect(screen.getByText('from the other session')).toBeInTheDocument();
  });

  it('shows the hooks as collapsed rows when switched on, remembers it, and keeps them out of the way of the group of calls', async () => {
    render(<LogViewer session={session} />);
    await screen.findByText('run the tests');
    fireEvent.click(filter('hooks'));
    expect(filter('hooks')).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(window.localStorage.getItem(FILTER_PREFS_KEY) ?? '{}')).toEqual({ bar: true, hooks: true });
    const hooks = screen.getAllByRole('button', { name: /^Hook(?!s)/ });
    expect(hooks).toHaveLength(2);
    expect(hooks[0]).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('bad json')).toBeNull();
    fireEvent.click(hooks[1]!);
    expect(screen.getByText('bad json')).toBeInTheDocument();
    expect(screen.getByText(/Exit code: 1/)).toBeInTheDocument();
    expect(screen.queryByText(/hidden/)).toBeNull();
  });

  it('hides the tool calls and the agent messages on request, and says how many', async () => {
    render(<LogViewer session={session} />);
    await screen.findByText('run the tests');
    fireEvent.click(filter('tools'));
    fireEvent.click(filter('agents'));
    expect(screen.queryByRole('button', { name: /^Bash/ })).toBeNull();
    expect(screen.queryByText('from the other session')).toBeNull();
    hoverTip(screen.getByText('5 hidden'));
    expect(liveTooltip().textContent).toBe('Hidden by the filters: 2 hooks, 1 tool calls, 2 agent messages');
    expect(screen.getByText('run the tests')).toBeInTheDocument();
    expect(screen.getByText('done')).toBeInTheDocument();
  });

  it('reads the saved choice at the start', async () => {
    window.localStorage.setItem(FILTER_PREFS_KEY, JSON.stringify({ bar: true, hooks: true, tools: false }));
    render(<LogViewer session={session} />);
    await screen.findByText('run the tests');
    expect(filter('hooks')).toHaveAttribute('aria-pressed', 'true');
    expect(filter('tools')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: /^Bash/ })).toBeNull();
  });

  it('an unreadable saved choice: the defaults and a sentence the user can dismiss', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    window.localStorage.setItem(FILTER_PREFS_KEY, '{nope');
    render(<LogViewer session={session} />);
    await screen.findByText('run the tests');
    expect(screen.getByText(/could not be read/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/could not be read/)).toBeNull();
  });

  it('every loaded entry hidden: says so instead of an empty log', async () => {
    entries = [hook('h1'), hook('h2')];
    render(<LogViewer session={session} />);
    expect(await screen.findByText(/Every loaded entry is hidden by the filters/)).toBeInTheDocument();
  });

  it('the toggles are a labelled group of buttons reachable by keyboard', async () => {
    render(<LogViewer session={session} />);
    await screen.findByText('run the tests');
    const group = screen.getByRole('group', { name: 'Show in the log' });
    expect(within(group).getAllByRole('button')).toHaveLength(3);
  });
});

describe('tool meta chips in the log', () => {
  it('a call row shows its chips with their sentences; a group shows the totals and a tooltip with every call', async () => {
    entries = [
      toolCall('e1', { name: 'Edit', status: 'ok', inputSummary: '/work/a.ts', meta: { file: '/work/a.ts', added: 12, removed: 3 }, durationMs: 400 }),
      toolCall('e2', { name: 'Edit', status: 'ok', inputSummary: '/work/b.ts', meta: { file: '/work/b.ts', added: 5, removed: 0 }, durationMs: 300 }),
      toolCall('b1', { name: 'Bash', status: 'ok', inputSummary: 'npm test', meta: { outputLines: 40 }, durationMs: 14_200, resultBytes: 2048 }),
    ];
    render(<LogViewer session={session} />);
    const group = await screen.findByRole('button', { name: /3 tool calls/ });
    hoverTip(group);
    // One line per call, each its own block in the card.
    expect([...liveTooltip().querySelectorAll('.text-left')].map((line) => line.textContent).join('\n')).toBe('Edit /work/a.ts: +12 -3, 400 ms\nEdit /work/b.ts: +5 -0, 300 ms\nBash npm test: 40 lines, 14 s');
    expect(within(group).getByRole('img', { name: '2 files changed: 17 lines added, 3 lines removed' })).toHaveTextContent('2 files+17-3');
    expect(within(group).getByRole('img', { name: '1 Bash call, 14 s in total' })).toBeInTheDocument();
    fireEvent.click(group);
    const edit = screen.getByRole('button', { name: /^Edit.*a\.ts/ });
    expect(within(edit).getByRole('img', { name: '12 lines added, 3 lines removed' })).toHaveTextContent('+12-3');
  });

  it('a call whose meta has nothing to say shows no chip', async () => {
    entries = [toolCall('x', { name: 'Skill', status: 'ok', inputSummary: 'w-doc' })];
    render(<LogViewer session={session} />);
    await screen.findByRole('button', { name: /^Skill/ });
    expect(document.querySelector('[data-meta-chips]')).toBeNull();
  });
});

describe('log filter bar: one row that scrolls', () => {
  it('never wraps onto the rail: one row, scrolls sideways, chips keep their size', async () => {
    render(<LogViewer session={session} />);
    await screen.findByText('run the tests');
    const group = screen.getByRole('group', { name: 'Show in the log' });
    expect(group).toHaveClass('flex-nowrap', 'overflow-x-auto');
    expect(group).not.toHaveClass('flex-wrap');
    expect(group.className).toContain('[&>*]:shrink-0');
  });
});

describe('the toggles of the filter bar read as on or off by their fill (Q32)', () => {
  it('a shown family is the filled neutral button, a hidden one is the plain ghost button', async () => {
    render(<LogViewer session={session} />);
    expect(await screen.findByText('run the tests')).toBeInTheDocument();
    // Hooks start hidden, tools and agent messages shown.
    // The class token itself: the ghost button only has hover:bg-muted-bg.
    expect(filter('tools').classList.contains('bg-muted-bg')).toBe(true);
    expect(filter('hooks').classList.contains('bg-muted-bg')).toBe(false);
  });
});
