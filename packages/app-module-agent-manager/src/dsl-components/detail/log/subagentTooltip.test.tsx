import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHOW_DELAY_MS } from '../deps.js';
import { subagent } from './entryFixtures.js';
import { flattenSubagents } from './subagentModel.js';
import { SubagentRow } from './SubagentRow.js';
import { SubagentTimeline } from './SubagentTimeline.js';
import { TimeLabel } from './TimeLabel.js';

const START = Date.parse('2026-11-26T10:00:00Z');
const T0 = START + 10 * 60_000;

/** The native tooltip text of every element under the container: it must not change while the pointer stays on it (a browser dismisses the tooltip when the attribute mutates). */
function titles(container: HTMLElement): string[] {
  return [...container.querySelectorAll('[title]')].map((element) => element.getAttribute('title') ?? '');
}

describe('native tooltips never embed a clock that ticks', () => {
  const [active] = flattenSubagents([subagent({ agentId: 'run00001', description: 'builder', status: 'active', finished: false, startedAt: START, lastActivityAt: T0 - 5000 })]);

  it('a sub-agent row (Summary)', () => {
    const { container, rerender } = render(<SubagentRow item={active!} now={T0} selected={false} locate="idle" onSelect={() => undefined} />);
    const before = titles(container);
    for (const advance of [1000, 61_000]) {
      rerender(<SubagentRow item={active!} now={T0 + advance} selected={false} locate="idle" onSelect={() => undefined} />);
      expect(titles(container)).toEqual(before);
    }
  });

  it('a sub-agent row (Timeline)', () => {
    const props = { items: [active!], all: [active!], selectedId: undefined, locate: 'idle' as const, onSelect: () => undefined, order: 'recent' as const, onOrder: () => undefined };
    const { container, rerender } = render(<SubagentTimeline {...props} now={T0} />);
    const before = titles(container);
    for (const advance of [1000, 61_000]) {
      rerender(<SubagentTimeline {...props} now={T0 + advance} />);
      expect(titles(container)).toEqual(before);
    }
  });

  it('the time of a log row in clock style', () => {
    const { container, rerender } = render(<TimeLabel timestamp={T0 - 30_000} now={T0} clock />);
    const before = titles(container);
    expect(before).toHaveLength(1);
    for (const advance of [1000, 61_000]) {
      rerender(<TimeLabel timestamp={T0 - 30_000} now={T0 + advance} clock />);
      expect(titles(container)).toEqual(before);
    }
  });
});

describe('the hover and focus card of a sub-agent', () => {
  const usage = { model: { id: 'claude-sonnet-4-6', displayName: 'Sonnet 4.6', known: true }, tokensIn: 100_005, tokensOut: 200, contextUsedPct: { value: 60, basis: 'estimate' as const, note: 'n', windowTokens: 200_000, compactAtTokens: 167_000, usedTokens: 100_005 } };
  const make = (patch: Parameters<typeof subagent>[0]) => flattenSubagents([subagent({ agentId: 'run00001', description: 'builder', agentType: 'general-purpose', startedAt: START, lastActivityAt: T0 - 5000, ...patch })])[0]!;
  const row = (item: ReturnType<typeof make>, now = T0) => <SubagentRow item={item} now={now} selected={false} locate="idle" onSelect={() => undefined} />;
  const facts = (card: HTMLElement): Record<string, string> => Object.fromEntries([...card.querySelectorAll('dt')].map((dt) => [dt.textContent ?? '', dt.nextElementSibling?.textContent ?? '']));

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
    return { ...view, card: screen.getByRole('tooltip') };
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
    expect(screen.getByRole('button')).toHaveAttribute('aria-describedby', card.id);
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
    expect(screen.getByRole('tooltip')).toBe(card);
    expect(facts(card)['Duration']).not.toBe(before);
    expect(facts(card)['Duration']).toContain('10m 01s');
  });

  it('closes on Escape and opens at once on keyboard focus', () => {
    const { card } = open(row(make({ status: 'finished' })));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(card).not.toBeInTheDocument();
    fireEvent.focus(screen.getByRole('button'));
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });

  it('never takes the pointer from the row', () => {
    const { card } = open(row(make({ status: 'finished' })));
    expect(card).toHaveClass('pointer-events-none');
  });
});
