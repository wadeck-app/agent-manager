import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HookRowsVariant, LogEntry, LogResponse } from '../deps.js';
import { DEFAULT_UI_VARIANTS, row, UiVariantsContext } from '../deps.js';
import { DetailHeader } from '../DetailHeader.js';
import { resetPending } from '../pending.js';
import { resetPublishedStatus } from '../status/useSessionStatus.js';
import { answer, assistantText, toolCall, userPrompt } from './entryFixtures.js';
import { resetFilterSummaries } from './filterSummary.js';
import { FILTER_PREFS_KEY } from './logFilters.js';
import { LogViewer } from './LogViewer.js';

const session = row({ displayName: 'shop-owner' });

const hook = (key: string, patch: Partial<Extract<LogEntry, { kind: 'hook' }>> = {}): LogEntry => ({ key, offset: 0, timestamp: 4_000, kind: 'hook', hookEvent: 'Stop', hookName: 'Stop', outcome: 'success', attachmentType: 'hook_success', durationMs: 108, ...patch });
const notice = (key: string, noticeKind: 'stop-hook' | 'turn-duration', patch: Partial<Extract<LogEntry, { kind: 'system-notice' }>> = {}): LogEntry => ({ key, offset: 0, timestamp: 5_000, kind: 'system-notice', noticeKind, subtype: noticeKind, isMeta: false, ...patch });
const thinking = (key: string): LogEntry => ({ key, offset: 0, timestamp: 2_500, kind: 'thinking', collapsible: true, text: 'let me think about the tests', textTruncated: false, textBytes: 27 });
const queueLine = (key: string): LogEntry => ({ key, offset: 0, timestamp: 2_600, kind: 'queue-operation', operation: 'dequeue' });

const json = (body: unknown): Response => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

let entries: LogEntry[];

beforeEach(() => {
  window.localStorage.clear();
  resetPending();
  resetFilterSummaries();
  resetPublishedStatus();
  Element.prototype.scrollIntoView = vi.fn();
  entries = [
    userPrompt('u', 'run the tests'),
    thinking('t1'),
    queueLine('q1'),
    toolCall('a', { status: 'ok', resultPreview: 'one' }),
    toolCall('b', { status: 'ok', resultPreview: 'two' }),
    toolCall('c', { status: 'ok', name: 'Agent', inputSummary: 'explorer', resultPreview: 'three' }),
    assistantText('z', 'done'),
    hook('h1'),
    notice('n1', 'stop-hook', { hookCount: 1, text: 'Ran 1 stop hook' }),
    notice('n2', 'turn-duration', { durationMs: 32_000 }),
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('/guardrails/overview')) {
        return json({ ok: true, grants: [], sessions: [], problems: [], killSwitch: { active: false, path: '', errorText: '' } });
      }
      if (url.includes('/guardrails/sessions/')) {
        return json({ ok: false, code: 'not-installed', sessionId: 'x', cwd: '', cwdNote: '', grants: [], errorText: 'w-guardrails is not installed (looked in x). Install it.' });
      }
      if (url.includes('/owned')) {
        return json({ ok: true, generatedAt: 'now', daemon: {}, sessions: [] });
      }
      return json(answer(entries) satisfies LogResponse);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function page(hookRows: HookRowsVariant = 'rows') {
  return render(
    <UiVariantsContext.Provider value={{ ...DEFAULT_UI_VARIANTS, hookRows }}>
      <DetailHeader session={session} now={2_000_000} busy={false} onBack={vi.fn()} onTogglePin={vi.fn()} onMarkSeen={vi.fn()} onOwnedChange={vi.fn()} onForgotten={vi.fn()} onForked={vi.fn()} onOpenSource={vi.fn()} />
      <LogViewer session={session} />
    </UiVariantsContext.Provider>,
  );
}

const filterButton = (): HTMLElement => screen.getByRole('button', { name: /^Log filters/ });
async function openPopup(): Promise<HTMLElement> {
  await userEvent.click(filterButton());
  return screen.getByRole('dialog', { name: 'Log filters' });
}
const saved = (): Record<string, unknown> => JSON.parse(window.localStorage.getItem(FILTER_PREFS_KEY) ?? '{}');

describe('the Thinking and Queue lines toggles', () => {
  it('shown by default with their counts; the badge counts only what is hidden', async () => {
    page();
    await screen.findByText('run the tests');
    expect(screen.getByRole('button', { name: /^Thinking/ })).toBeInTheDocument();
    expect(screen.getByText('dequeue')).toBeInTheDocument();
    const popup = await openPopup();
    expect(within(popup).getByRole('switch', { name: 'Thinking' })).toBeChecked();
    expect(within(popup).getByRole('switch', { name: 'Queue lines' })).toBeChecked();
    expect(popup.querySelector('[data-filter-row="thinking"]')).toHaveTextContent('1');
    expect(popup.querySelector('[data-filter-row="queue"]')).toHaveTextContent('1');
    // Only the hooks (2) are hidden by default.
    expect(filterButton()).toHaveAccessibleName('Log filters, 2 entries hidden');
  });

  it('turning Thinking off hides the blocks, adds them to the badge, is saved, and Reset brings them back', async () => {
    page();
    await screen.findByText('run the tests');
    const popup = await openPopup();
    await userEvent.click(within(popup).getByRole('switch', { name: 'Thinking' }));
    await userEvent.click(within(popup).getByRole('switch', { name: 'Queue lines' }));
    expect(screen.queryByRole('button', { name: /^Thinking/ })).toBeNull();
    expect(screen.queryByText('dequeue')).toBeNull();
    expect(saved()).toEqual({ thinking: false, queue: false });
    expect(filterButton()).toHaveAccessibleName('Log filters, 4 entries hidden');
    await userEvent.click(within(popup).getByRole('button', { name: 'Reset filters' }));
    expect(screen.getByRole('button', { name: /^Thinking/ })).toBeInTheDocument();
    expect(filterButton()).toHaveAccessibleName('Log filters, 2 entries hidden');
  });

  it('the bar shows the toggle too and the hidden marker counts it', async () => {
    window.localStorage.setItem(FILTER_PREFS_KEY, JSON.stringify({ bar: true, hooks: true, thinking: false }));
    page();
    await screen.findByText('run the tests');
    expect(document.querySelector('[data-filter="thinking"]')).toHaveAttribute('aria-pressed', 'false');
    expect(document.querySelector('[data-hidden-marker]')).toHaveTextContent('1 hidden');
  });
});

describe('Group consecutive calls', () => {
  it('on by default: the three calls are one row "3 tool calls"', async () => {
    page();
    await screen.findByText('run the tests');
    expect(screen.getByRole('button', { name: /3 tool calls/ })).toBeInTheDocument();
  });

  it('off (saved, with the effect in one line): one row per call, each opens on its own, the filters still work', async () => {
    page();
    await screen.findByText('run the tests');
    const popup = await openPopup();
    const toggle = within(popup).getByRole('switch', { name: 'Group consecutive calls' });
    expect(popup.querySelector('[data-grouping-row]')).toHaveTextContent('On: a run of tool calls or agent calls is one row');
    await userEvent.click(toggle);
    expect(popup.querySelector('[data-grouping-row]')).toHaveTextContent('Off: one row per tool call or agent call');
    expect(saved()).toEqual({ group: false });
    expect(screen.queryByRole('button', { name: /3 tool calls/ })).toBeNull();
    const bash = screen.getAllByRole('button', { name: /^Bash/ });
    expect(bash).toHaveLength(2);
    expect(screen.getByRole('button', { name: /^Agent/ })).toBeInTheDocument();
    await userEvent.click(bash[0]!);
    expect(bash[0]).toHaveAttribute('aria-expanded', 'true');
    expect(bash[1]).toHaveAttribute('aria-expanded', 'false');
    // The agent calls follow the filter of their own family.
    await openPopup();
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Log filters' })).getByRole('switch', { name: 'Agent messages' }));
    expect(screen.queryByRole('button', { name: /^Agent/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Bash/ })).toHaveLength(2);
  });
});

describe('the Hook rows look', () => {
  const showHooks = (): void => window.localStorage.setItem(FILTER_PREFS_KEY, JSON.stringify({ hooks: true }));

  it('rows (default): today, a row for each hook and each notice, with the same words', async () => {
    showHooks();
    page();
    await screen.findByText('run the tests');
    expect(screen.getByRole('button', { name: /^Hook/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /System: stop-hook/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /System: turn-duration/ })).toBeInTheDocument();
    expect(document.querySelector('[data-system-look]')).toBeNull();
  });

  it.each(['merged', 'footer', 'chips'] as const)('%s: one condensed entry, the same information, every line one click away', async (look) => {
    showHooks();
    page(look);
    await screen.findByText('run the tests');
    expect(screen.queryByRole('button', { name: /System: turn-duration/ })).toBeNull();
    const strip = screen.getByRole('button', { name: /^System(?!:)/ });
    expect(strip).toHaveAccessibleName(expect.stringContaining('turn took 32 s'));
    expect(strip).toHaveAccessibleName(expect.stringContaining('stop-hook'));
    expect(strip).toHaveAccessibleName(expect.stringContaining('Stop'));
    await userEvent.click(strip);
    const lines = document.querySelector('[data-system-lines]') as HTMLElement;
    expect(within(lines).getByRole('button', { name: /Hook/ })).toBeInTheDocument();
    expect(within(lines).getByRole('button', { name: /System: stop-hook/ })).toBeInTheDocument();
    expect(within(lines).getByRole('button', { name: /System: turn-duration/ })).toBeInTheDocument();
    // Each line opens in turn: the duration of the turn is in its body.
    await userEvent.click(within(lines).getByRole('button', { name: /System: turn-duration/ }));
    expect(within(lines).getAllByText(/took 32 s/).length).toBeGreaterThan(0);
  });

  it.each(['merged', 'footer', 'chips'] as const)('%s: the Hooks filter still hides the hooks (the turn stays)', async (look) => {
    page(look);
    await screen.findByText('run the tests');
    const strip = screen.getByRole('button', { name: /^System(?!:)/ });
    expect(strip).toHaveAccessibleName(expect.stringContaining('turn took 32 s'));
    expect(strip).not.toHaveAccessibleName(expect.stringContaining('stop-hook'));
    expect(strip).not.toHaveAccessibleName(expect.stringContaining('Stop'));
  });

  it.each(['merged', 'footer', 'chips'] as const)('%s: a failed hook is said in words and in red', async (look) => {
    entries = [...entries.slice(0, 7), hook('h1', { outcome: 'error', hookName: 'PreToolUse:Bash' }), notice('n2', 'turn-duration', { durationMs: 32_000 })];
    showHooks();
    page(look);
    await screen.findByText('run the tests');
    const strip = screen.getByRole('button', { name: /^System(?!:)/ });
    expect(strip).toHaveAccessibleName(expect.stringContaining('PreToolUse:Bash failed'));
    expect(strip.outerHTML).toMatch(/hue-red/);
  });

  it('the chips look has one chip per hook, one for the stop hooks and one for the duration', async () => {
    showHooks();
    page('chips');
    await screen.findByText('run the tests');
    expect(document.querySelectorAll('[data-system-chip]').length).toBe(3);
    expect(document.querySelector('[data-system-chip="turn"]')).toHaveTextContent('took 32 s');
  });
});
