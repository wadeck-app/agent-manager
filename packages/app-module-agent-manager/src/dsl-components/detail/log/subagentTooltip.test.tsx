import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subagent } from './entryFixtures.js';
import { flattenSubagents } from './subagentModel.js';
import { SubagentRow } from './SubagentRow.js';
import { SubagentTimeline } from './SubagentTimeline.js';
import { TimeLabel } from './TimeLabel.js';

/** The delay of the dsl-ui Tooltip before the pointer opens its card (its default). */
const SHOW_DELAY_MS = 300;
const START = Date.parse('2026-11-26T10:00:00Z');
const T0 = START + 10 * 60_000;

/** The native tooltip text of every element under the container: there must be none (the dsl-ui card is the only hint, a native one would double it). */
function titles(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[title]')].map((element) => element.getAttribute('title') ?? '');
}

describe('no native tooltip on a sub-agent row or a log time', () => {
  const [active] = flattenSubagents([subagent({ agentId: 'run00001', description: 'builder', status: 'active', finished: false, startedAt: START, lastActivityAt: T0 - 5000 })]);

  it('a sub-agent row (Summary)', () => {
    const { container } = render(<SubagentRow item={active!} now={T0} selected={false} locate="idle" onSelect={() => undefined} />);
    expect(titles(container)).toEqual([]);
  });

  it('a sub-agent row (Timeline)', () => {
    const props = { items: [active!], all: [active!], selectedId: undefined, locate: 'idle' as const, onSelect: () => undefined, order: 'recent' as const, onOrder: () => undefined };
    const { container } = render(<SubagentTimeline {...props} now={T0} />);
    expect(titles(container)).toEqual([]);
  });

  it('the time of a log row: its exact time is in the card, never the relative text that ticks', () => {
    vi.useFakeTimers();
    const { container } = render(<TimeLabel timestamp={T0 - 30_000} now={T0} clock />);
    expect(titles(container)).toEqual([]);
    fireEvent.pointerEnter(container.querySelector('time')!.parentElement!);
    act(() => {
      vi.advanceTimersByTime(SHOW_DELAY_MS);
    });
    expect(screen.getByTestId('tooltip-card').textContent).toContain('2026');
    vi.useRealTimers();
  });
});

describe('the hover and focus card of a sub-agent', () => {
  const usage = { model: { id: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6', known: true }, tokensIn: 100_005, tokensOut: 200, contextUsedPct: { value: 60, basis: 'estimate' as const, note: 'n', windowTokens: 200_000, compactAtTokens: 167_000, usedTokens: 100_005 } };
  const make = (patch: Parameters<typeof subagent>[0]) => flattenSubagents([subagent({ agentId: 'run00001', description: 'builder', agentType: 'general-purpose', startedAt: START, lastActivityAt: T0 - 5000, ...patch })])[0]!;
  const row = (item: ReturnType<typeof make>, now = T0) => <SubagentRow item={item} now={now} selected={false} locate="idle" onSelect={() => undefined} />;
  const facts = (card: HTMLElement): Record<string, string> => Object.fromEntries([...card.querySelectorAll('dt')].map((dt) => [dt.textContent ?? '', dt.nextElementSibling?.textContent ?? '']));
  const cardOf = (): HTMLElement => screen.getByTestId('tooltip-card');

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function open(element: React.ReactElement) {
    const view = render(element);
    fireEvent.pointerEnter(screen.getByRole('button').parentElement!);
    act(() => {
      vi.advanceTimersByTime(SHOW_DELAY_MS);
    });
    return { ...view, card: cardOf() };
  }

  it('shows labelled rows with the model, type, status reason, tokens and context of an active sub-agent, and says the cost is not available and why', () => {
    const { card } = open(row(make({ status: 'active', finished: false, usage })));
    const shown = facts(card);
    expect(Object.keys(shown)).toEqual(['Name', 'Type', 'Model', 'Status', 'Started', 'Duration', 'Last activity', 'Tokens', 'Cost', 'Context']);
    expect(shown['Model']).toBe('Sonnet 4.6');
    expect(shown['Type']).toBe('general-purpose');
    expect(shown['Status']).toContain('no end marker');
    expect(shown['Duration']).toContain('10m 00s');
    expect(shown['Tokens']).toContain('100.0k in / 200 out');
    expect(shown['Context']).toContain('60%');
    expect(shown['Cost']).toMatch(/Not available.*no price table/);
    // The trigger is described by the always present, screen reader only copy of the card.
    expect(screen.getByRole('button').getAttribute('aria-describedby')).toBeTruthy();
  });

  it('says why a value is missing instead of leaving it out', () => {
    const { card } = open(row(make({ status: 'failed', failureReason: 'Stopped by the user', usageNote: 'No transcript yet: the sub-agent has not written anything.', startedAt: undefined, lastActivityAt: undefined })));
    const shown = facts(card);
    expect(shown['Status']).toContain('Stopped by the user');
    for (const label of ['Model', 'Tokens', 'Context']) {
      expect(shown[label], label).toMatch(/Not available.*No transcript yet/);
    }
    expect(shown['Started']).toMatch(/Not available/);
  });

  it('keeps the same card element while a running sub-agent ticks: the duration changes in place (no remount, no flicker)', () => {
    const item = make({ status: 'active', finished: false, usage });
    const { card, rerender } = open(row(item));
    const before = facts(card)['Duration'];
    rerender(row(item, T0 + 1000));
    expect(cardOf()).toBe(card);
    expect(facts(card)['Duration']).not.toBe(before);
    expect(facts(card)['Duration']).toContain('10m 01s');
  });

  it('closes on Escape', () => {
    const { card } = open(row(make({ status: 'finished' })));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(card).not.toBeInTheDocument();
  });

  it('opens at once on keyboard focus, without the hover delay', () => {
    render(row(make({ status: 'finished' })));
    // A keyboard user arrives with Tab (the key press is what makes the browser, and jsdom, treat the focus as keyboard focus).
    fireEvent.keyDown(document.body, { key: 'Tab' });
    act(() => {
      screen.getByRole('button').focus();
    });
    expect(cardOf()).toBeInTheDocument();
  });

  it('never takes the pointer from the row', () => {
    const { card } = open(row(make({ status: 'finished' })));
    expect(card).toHaveClass('pointer-events-none');
  });

  it('stays open while a running sub-agent ticks for several seconds (no close, no remount)', () => {
    const item = make({ status: 'active', finished: false, usage });
    const { card, rerender } = open(row(item));
    for (let second = 1; second <= 6; second += 1) {
      rerender(row(item, T0 + second * 1000));
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(cardOf()).toBe(card);
    }
    expect(facts(card)['Duration']).toContain('10m 06s');
  });
});
