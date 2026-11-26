import { hoverTip, liveTooltip } from '../detail/status/liveTooltip.js';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { row } from '../logic/fixtures.js';
import { SessionsTable } from './SessionsTable.js';

describe('SessionsTable', () => {
  it('is a semantic table with the columns of the old Table page', () => {
    render(<SessionsTable rows={[row({ displayName: 'agent-manager-owner', folder: 'agent-manager', state: 'working', status: 'busy' })]} />);
    const table = screen.getByRole('table', { name: 'Agents table' });
    const headers = within(table).getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toEqual(['Session', 'Folder', 'Status', 'Detail', 'Status since', 'PID', 'Harness', 'Alive']);
  });

  it('writes the state with the vocabulary and the shared chip variants of the Agents page (the two warm states share the warning one), not busy / idle / other', () => {
    const states = [
      ['needs-you', 'Needs you', 'text-hue-red'],
      ['done', 'Done', 'text-hue-blue'],
      ['working', 'Working', 'text-warning-text'],
      ['idle', 'Idle', 'text-muted-tint'],
      ['other', 'Other', 'text-warning-text'],
      ['ended', 'Ended', 'text-muted-tint'],
    ] as const;
    render(<SessionsTable rows={states.map(([state]) => row({ state, displayName: `s-${state}` }))} />);
    for (const [state, label, colour] of states) {
      const line = screen.getByRole('row', { name: new RegExp(`s-${state}`) });
      const chip = within(line).getByText(label);
      expect(chip.closest('[data-state-chip]')?.className, state).toContain(colour);
    }
    // The Status column only holds those words (the Detail column keeps the raw registry status, which is information of another kind).
    const chips = within(screen.getByRole('table')).getAllByRole('row').flatMap((line) => Array.from(line.querySelectorAll('[data-state-chip]')).map((chip) => chip.textContent));
    expect(chips).toEqual(['Needs you', 'Done', 'Working', 'Idle', 'Other', 'Ended']);
  });

  it('never colours the harness by its version: the chip is neutral whatever harnessVariant says', () => {
    render(<SessionsTable rows={[row({ harness: 'Claude Code 2.1.322', harnessVariant: 'warning' }), row({ harness: 'Claude Code 2.1.325', harnessVariant: 'success' })]} />);
    for (const text of ['Claude Code 2.1.322', 'Claude Code 2.1.325']) {
      const chip = screen.getByText(text).closest('[data-harness-chip]');
      expect(chip?.className).toContain('bg-muted-bg');
      expect(chip?.className).not.toMatch(/success|warning|danger|hue-/);
    }
  });

  it('keeps words whole: no break-all anywhere, a long name is cut with an ellipsis on one line, never wrapped mid-word', () => {
    const { container } = render(<SessionsTable rows={[row({ displayName: 'agent-manager-owner' })]} />);
    expect(container.innerHTML).not.toMatch(/break-all|break-words/);
    // The cell holds the name in a truncating link; its full text is the tooltip.
    expect(screen.getByRole('cell', { name: 'agent-manager-owner' }).querySelector('.truncate')).not.toBeNull();
    hoverTip(screen.getByRole('cell', { name: 'agent-manager-owner' }).querySelector('a') as HTMLElement);
    expect(liveTooltip().textContent).toContain('agent-manager-owner');
  });

  it('links the name to the session on the Agents page and says what a dead session is', () => {
    const live = row({ displayName: 'a-live', sessionId: '11111111-1111-4111-8111-111111111111' });
    const dead = row({ displayName: 'a-dead', alive: false, state: 'ended' });
    render(<SessionsTable rows={[live, dead]} />);
    expect(screen.getByRole('link', { name: 'a-live' }).getAttribute('href')).toBe('/modules/agent-manager/agents?session=11111111-1111-4111-8111-111111111111');
    expect(within(screen.getByRole('row', { name: /a-dead/ })).getByText('dead')).toBeTruthy();
  });

  it('puts what the session waits for in Detail', () => {
    render(<SessionsTable rows={[row({ status: 'waiting', reason: 'permission prompt: Bash(npm test)', state: 'needs-you' })]} />);
    expect(screen.getByText('waiting: permission prompt: Bash(npm test)')).toBeTruthy();
  });

  it('says it is loading, and says when there is nothing, never an empty frame', () => {
    const { rerender } = render(<SessionsTable />);
    expect(screen.getByRole('status').textContent).toMatch(/loading/i);
    rerender(<SessionsTable rows={[]} />);
    expect(screen.getByText('No session to show')).toBeTruthy();
    rerender(<SessionsTable rows={[]} emptyText="No Claude Code session folder was found." />);
    expect(screen.getByText('No Claude Code session folder was found.')).toBeTruthy();
  });

  it('puts the hidden-dead sentence above the table as plain text (no pill that collapses on a phone)', () => {
    render(<SessionsTable rows={[row()]} hiddenText="1 dead session is hidden; show them with the filter." />);
    const text = screen.getByText('1 dead session is hidden; show them with the filter.');
    expect(text.tagName).toBe('P');
    expect(text.className).not.toContain('rounded-full');
  });
});
