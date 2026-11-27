import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CostDto, SessionCostDto } from '../deps.js';
import { liveTooltip, focusByKeyboard } from './liveTooltip.js';
import { costValue, sessionCostLines } from './costText.js';
import { formatUsd } from './format.js';
import { TokenCounts } from './TokenCounts.js';

afterEach(() => vi.restoreAllMocks());

const cost = (usd: number, patch: Partial<CostDto> = {}): CostDto => ({ usd, pricedMessages: 3, unpriced: [], asOf: '2026-11-27', ...patch });
const SESSION: SessionCostDto = { main: cost(12.3456), subagents: { ...cost(0.0123), agents: 2, withoutUsage: 0 }, total: cost(12.3579) };

describe('formatUsd', () => {
  it.each([
    [12.3456, '$12.35'],
    [1, '$1.00'],
    [1234.5, '$1,234.50'],
    [0.5, '$0.500'],
    [0.0123456, '$0.0123'],
    [0.00123, '$0.0012'],
    [0.00001, '<$0.0001'],
    [0, '$0.00'],
  ])('%s -> %s', (value, text) => {
    expect(formatUsd(value)).toBe(text);
  });
});

describe('costValue', () => {
  it('is the figure for a fully priced cost', () => {
    expect(costValue(cost(0.0123))).toMatchObject({ text: '$0.0123', priced: true, partial: false });
  });

  it('says "No price for <model>" when nothing could be priced, never $0', () => {
    const value = costValue(cost(0, { pricedMessages: 0, unpriced: [{ model: 'claude-future-9', messages: 4, reason: 'no price for claude-future-9 in the table dated 2026-11-27' }] }));
    expect(value.text).toBe('No price for claude-future-9');
    expect(value.priced).toBe(false);
    expect(value.note).toContain('claude-future-9 (4 messages)');
  });

  it('is a lower bound when some messages are unpriced', () => {
    const value = costValue(cost(2, { unpriced: [{ model: 'claude-future-9', messages: 1, reason: 'r' }] }));
    expect(value).toMatchObject({ text: 'at least $2.00', partial: true });
    expect(value.note).toContain('No price for claude-future-9 (1 message)');
  });
});

describe('sessionCostLines', () => {
  it('lists the main session, the sub-agents and the total', () => {
    expect(sessionCostLines(SESSION)).toEqual([
      { label: 'Main session', value: '$12.35', missing: false },
      { label: 'Sub-agents (2)', value: '$0.0123', missing: false },
      { label: 'Total', value: '$12.36', missing: false },
    ]);
  });

  it('says why the main session has no figure and names the models without price', () => {
    const lines = sessionCostLines({ mainNote: 'No transcript yet', subagents: { ...cost(0, { pricedMessages: 0 }), agents: 0, withoutUsage: 0 }, total: cost(0, { pricedMessages: 0, unpriced: [{ model: 'claude-future-9', messages: 2, reason: 'r' }] }) });
    expect(lines).toEqual([
      { label: 'Main session', value: 'No transcript yet', missing: true },
      { label: 'Sub-agents', value: 'None', missing: false },
      { label: 'Total', value: 'No price for claude-future-9', missing: true },
      { label: 'No price for', value: 'claude-future-9 (2 messages)', missing: true },
    ]);
  });
});

describe('the tooltip of the tokens chip', () => {
  it('shows the three cost rows and says it is an estimate from the dated price table', () => {
    render(<TokenCounts tokensIn={1000} tokensOut={50} cost={SESSION} />);
    focusByKeyboard(screen.getByLabelText(/^Tokens:/));
    const card = liveTooltip();
    const rows = Object.fromEntries([...card.querySelectorAll('dt')].map((dt) => [dt.textContent ?? '', dt.nextElementSibling?.textContent ?? '']));
    expect(rows).toEqual({ 'Main session': '$12.35', 'Sub-agents (2)': '$0.0123', Total: '$12.36' });
    expect(card).toHaveTextContent(/Estimate computed by this app.*table of 2026-11-27.*not your bill/);
  });

  it('has no cost rows and no estimate note without a cost', () => {
    render(<TokenCounts tokensIn={1000} tokensOut={50} />);
    focusByKeyboard(screen.getByLabelText(/^Tokens:/));
    expect(liveTooltip().querySelectorAll('dt')).toHaveLength(0);
    expect(liveTooltip()).not.toHaveTextContent('Estimate');
  });
});
