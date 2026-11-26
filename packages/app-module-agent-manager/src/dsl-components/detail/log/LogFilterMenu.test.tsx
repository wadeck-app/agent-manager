import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogEntry, LogResponse } from '../deps.js';
import { row } from '../deps.js';
import { DetailHeader } from '../DetailHeader.js';
import { resetPending } from '../pending.js';
import { resetPublishedStatus } from '../status/useSessionStatus.js';
import { answer, assistantText, toolCall, userPrompt } from './entryFixtures.js';
import { resetFilterSummaries } from './filterSummary.js';
import { FILTER_PREFS_KEY, FILTER_WRITE_PROBLEM } from './logFilters.js';
import { LogViewer } from './LogViewer.js';

const session = row({ displayName: 'shop-owner', guardrailBlocks: { total: 273, categories: [{ category: 'rm', count: 84 }], timeout: false, recent: { total: 3, categories: [{ category: 'rm', count: 2 }, { category: 'kill', count: 1 }] } } });

const hook = (key: string): LogEntry => ({ key, offset: 0, timestamp: 3_000, kind: 'hook', hookEvent: 'PreToolUse', hookName: 'PreToolUse:Bash', outcome: 'success', attachmentType: 'hook_success', durationMs: 108 });
const peer = (key: string): LogEntry => ({ ...(userPrompt(key, 'from the other session') as Extract<LogEntry, { kind: 'user-prompt' }>), source: 'peer', isMeta: true, peer: { name: 'other' } });

const json = (body: unknown): Response => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

let entries: LogEntry[];

beforeEach(() => {
  window.localStorage.clear();
  resetPending();
  resetFilterSummaries();
  resetPublishedStatus();
  Element.prototype.scrollIntoView = vi.fn();
  entries = [userPrompt('u', 'run the tests'), toolCall('a', { status: 'ok', resultPreview: 'one' }), hook('h1'), hook('h2'), assistantText('mid', 'between'), toolCall('b', { status: 'ok', name: 'SendMessage', inputSummary: 'worker' }), peer('p'), assistantText('z', 'done')];
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

/** What the page puts side by side: the header of the open agent and its log. */
function page(blocks = session) {
  return render(
    <>
      <DetailHeader session={blocks} now={2_000_000} busy={false} onBack={vi.fn()} onTogglePin={vi.fn()} onMarkSeen={vi.fn()} onOwnedChange={vi.fn()} onForgotten={vi.fn()} onForked={vi.fn()} onOpenSource={vi.fn()} />
      <LogViewer session={blocks} />
    </>,
  );
}

const filterButton = (): HTMLElement => screen.getByRole('button', { name: /^Log filters/ });

async function openPopup(): Promise<HTMLElement> {
  await userEvent.click(filterButton());
  return screen.getByRole('dialog', { name: 'Log filters' });
}

describe('the filter bar is hidden by default', () => {
  it('no bar above the log, the log is filtered with the defaults (hooks hidden), and the button of the header says how many entries are hidden', async () => {
    page();
    expect(await screen.findByText('run the tests')).toBeInTheDocument();
    expect(document.querySelector('[data-filter]')).toBeNull();
    expect(screen.queryByText('Hook')).toBeNull();
    expect(filterButton()).toHaveAccessibleName('Log filters, 2 entries hidden');
    expect(document.querySelector('[data-filter-badge]')).toHaveTextContent('2');
  });

  it('nothing hidden: the button has no badge and says nothing is hidden', async () => {
    entries = [userPrompt('u', 'run the tests'), assistantText('z', 'done')];
    page();
    await screen.findByText('run the tests');
    expect(filterButton()).toHaveAccessibleName('Log filters');
    expect(document.querySelector('[data-filter-badge]')).toBeNull();
  });
});

describe('the filter popup of the header', () => {
  it('opens on the button, with one switch per family and its count among the loaded entries', async () => {
    page();
    await screen.findByText('run the tests');
    const popup = await openPopup();
    const group = within(popup).getByRole('group', { name: 'Show in the log' });
    expect(within(group).getByRole('switch', { name: 'Hooks' })).not.toBeChecked();
    expect(within(group).getByRole('switch', { name: 'Tools' })).toBeChecked();
    expect(within(group).getByRole('switch', { name: 'Agent messages' })).toBeChecked();
    expect(group.querySelector('[data-filter-row="hooks"]')).toHaveTextContent('2');
    expect(group.querySelector('[data-filter-row="tools"]')).toHaveTextContent('1');
    expect(group.querySelector('[data-filter-row="agents"]')).toHaveTextContent('2');
    expect(filterButton()).toHaveAttribute('aria-expanded', 'true');
  });

  it('a switch changes the log at once, the badge follows, and the choice is saved like the bar saves it', async () => {
    page();
    await screen.findByText('run the tests');
    const popup = await openPopup();
    await userEvent.click(within(popup).getByRole('switch', { name: 'Hooks' }));
    expect(screen.getAllByRole('button', { name: /^Hook(?!s)/ })).toHaveLength(2);
    expect(JSON.parse(window.localStorage.getItem(FILTER_PREFS_KEY) ?? '{}')).toEqual({ hooks: true });
    expect(filterButton()).toHaveAccessibleName('Log filters');
    await userEvent.click(within(popup).getByRole('switch', { name: 'Tools' }));
    expect(screen.queryByRole('button', { name: /^Bash/ })).toBeNull();
    expect(filterButton()).toHaveAccessibleName('Log filters, 1 entry hidden');
  });

  it('Reset filters brings the defaults back and is off while they are the defaults', async () => {
    window.localStorage.setItem(FILTER_PREFS_KEY, JSON.stringify({ hooks: true, tools: false }));
    page();
    await screen.findByText('run the tests');
    const popup = await openPopup();
    const reset = within(popup).getByRole('button', { name: 'Reset filters' });
    expect(reset).toBeEnabled();
    await userEvent.click(reset);
    expect(within(popup).getByRole('switch', { name: 'Hooks' })).not.toBeChecked();
    expect(within(popup).getByRole('switch', { name: 'Tools' })).toBeChecked();
    expect(screen.getByRole('button', { name: /^Bash/ })).toBeInTheDocument();
    expect(within(popup).getByRole('button', { name: 'Reset filters' })).toBeDisabled();
  });

  it('Show the filter bar displays the bar above the log (same switches, same state), is saved, and is read back at the next start', async () => {
    const { unmount } = page();
    await screen.findByText('run the tests');
    const popup = await openPopup();
    expect(within(popup).getByRole('switch', { name: 'Show the filter bar' })).not.toBeChecked();
    await userEvent.click(within(popup).getByRole('switch', { name: 'Show the filter bar' }));
    const filter = (name: string): HTMLElement => document.querySelector(`[data-filter="${name}"]`) as HTMLElement;
    expect(filter('hooks')).toHaveAttribute('aria-pressed', 'false');
    expect(JSON.parse(window.localStorage.getItem(FILTER_PREFS_KEY) ?? '{}')).toEqual({ bar: true });
    // The bar and the popup are two views of one state.
    fireEvent.click(filter('hooks'));
    expect(within(popup).getByRole('switch', { name: 'Hooks' })).toBeChecked();
    unmount();
    page();
    await screen.findByText('run the tests');
    expect(document.querySelector('[data-filter="hooks"]')).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(filterButton());
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Log filters' })).getByRole('switch', { name: 'Show the filter bar' }));
    expect(document.querySelector('[data-filter]')).toBeNull();
    expect(JSON.parse(window.localStorage.getItem(FILTER_PREFS_KEY) ?? '{}')).toEqual({ bar: false, hooks: true });
  });

  it('Reset filters keeps the display choice of the bar', async () => {
    window.localStorage.setItem(FILTER_PREFS_KEY, JSON.stringify({ bar: true, hooks: true }));
    page();
    await screen.findByText('run the tests');
    await userEvent.click(within(await openPopup()).getByRole('button', { name: 'Reset filters' }));
    expect(document.querySelector('[data-filter="hooks"]')).toHaveAttribute('aria-pressed', 'false');
  });

  it('Escape closes it and the focus goes back to the button; a second click on the button closes it too', async () => {
    page();
    await screen.findByText('run the tests');
    await openPopup();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Log filters' })).toBeNull();
    expect(filterButton()).toHaveFocus();
    await openPopup();
    await userEvent.click(filterButton());
    expect(screen.queryByRole('dialog', { name: 'Log filters' })).toBeNull();
  });

  it('the switches are reachable with the keyboard (Tab from the first one) and Space flips them', async () => {
    page();
    await screen.findByText('run the tests');
    await openPopup();
    const hooks = screen.getByRole('switch', { name: 'Hooks' });
    hooks.focus();
    await userEvent.keyboard(' ');
    expect(hooks).toBeChecked();
  });

  it('a choice that cannot be saved says so in the popup and above the log, even with the bar hidden', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    page();
    await screen.findByText('run the tests');
    const popup = await openPopup();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    await userEvent.click(within(popup).getByRole('switch', { name: 'Hooks' }));
    expect(within(popup).getByRole('alert')).toHaveTextContent(FILTER_WRITE_PROBLEM);
    expect(screen.getAllByText(FILTER_WRITE_PROBLEM).length).toBeGreaterThanOrEqual(2);
  });

  it('an unreadable saved choice still shows its sentence while the bar is hidden', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    window.localStorage.setItem(FILTER_PREFS_KEY, '{nope');
    page();
    await screen.findByText('run the tests');
    expect(screen.getByText(/could not be read/)).toBeInTheDocument();
    expect(document.querySelector('[data-filter]')).toBeNull();
  });

  it('a `bar` that is not a boolean is an unreadable choice, not a silent default', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    window.localStorage.setItem(FILTER_PREFS_KEY, JSON.stringify({ bar: 'yes' }));
    page();
    await screen.findByText('run the tests');
    expect(screen.getByText(/could not be read/)).toBeInTheDocument();
  });
});

describe('the blocked chip of the header opens the Permissions tab', () => {
  it('a click on the chip shows the Permissions tab of the panel beside the log, even collapsed', async () => {
    page();
    await screen.findByText('run the tests');
    expect(screen.queryByRole('group', { name: 'Panel tabs' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /^3 blocked/ }));
    const tabs = await screen.findByRole('group', { name: 'Panel tabs' });
    expect(within(tabs).getAllByRole('button').length).toBeGreaterThan(0);
    expect(screen.getByRole('complementary', { name: 'Permissions' })).toBeInTheDocument();
    await act(async () => undefined);
  });
});
