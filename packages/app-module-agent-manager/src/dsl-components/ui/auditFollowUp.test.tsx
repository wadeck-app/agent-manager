import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { groupReasons, visibleReasonGroups } from '../logic/adoptSwitch.js';
import { ReasonList, VISIBLE_REASONS } from '../owned/ReasonList.js';
import { ConfirmDialog } from './ConfirmDialog.js';

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const REASONS = [
  'Waiting on permission prompt: Bash(npm test): it is not replayed after the switch',
  '1 permission request waits for an answer: not replayed after the switch',
  'A sub-agent call is running (Agent `A`): it is reported as not finished and its result is lost',
  'A sub-agent call is running (Agent `B`): it is reported as not finished and its result is lost',
  'Tool Bash `npm run build` is running: its process may keep running unseen after the stop (orphan), and its result will never reach the conversation',
  '10 queued messages not yet absorbed: they stay as unanswered lines',
  'Cannot tell whether something is running (older background tasks could not be checked). Treated as busy.',
];

describe('the reasons of a Move that is not free', () => {
  it('are grouped by kind, each group with its count and one consequence line; an unknown reason is kept under Other', () => {
    const groups = groupReasons([...REASONS, 'something new']);
    expect(groups.map((group) => [group.kind, group.reasons.length])).toEqual([
      ['waiting', 2],
      ['subagent', 2],
      ['tool', 1],
      ['queued', 1],
      ['unknown', 1],
      ['other', 1],
    ]);
    expect(groups.every((group) => group.consequence !== '')).toBe(true);
  });

  it('lists the groups that have a reason within the limit, whole groups of reasons kept for the count', () => {
    const groups = groupReasons(REASONS);
    const listed = visibleReasonGroups(groups, 3);
    expect(listed.map((entry) => [entry.group.kind, entry.group.reasons.length, entry.shown.length])).toEqual([
      ['waiting', 2, 2],
      ['subagent', 2, 1],
    ]);
    expect(visibleReasonGroups(groups, 0)).toEqual([]);
    expect(visibleReasonGroups(groups, Number.POSITIVE_INFINITY)).toHaveLength(groups.length);
  });

  it('shows at most 3 details, then "Show N more" reveals the rest and "Show fewer details" folds them again', async () => {
    render(<ReasonList reasons={REASONS} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(VISIBLE_REASONS);
    // A group with a listed reason names itself (with its total) and says what the move does to it; a group with none listed yet has no heading.
    expect(screen.getByRole('heading', { name: 'Waiting for an answer (2)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sub-agents (2)' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Cannot tell what runs (1)' })).toBeNull();
    const more = screen.getByRole('button', { name: `Show ${REASONS.length - VISIBLE_REASONS} more` });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(more);
    expect(screen.getAllByRole('listitem')).toHaveLength(REASONS.length);
    expect(screen.getAllByRole('heading')).toHaveLength(5);
    expect(screen.getByRole('heading', { name: 'Cannot tell what runs (1)' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show fewer details' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(VISIBLE_REASONS);
  });

  it('never shows a heading without a bullet under it, collapsed or not', () => {
    const { container } = render(<ReasonList reasons={REASONS} />);
    for (const section of container.querySelectorAll('section')) {
      expect(section.querySelectorAll('li').length).toBeGreaterThan(0);
    }
  });

  it('has no "Show more" when everything fits', () => {
    render(<ReasonList reasons={REASONS.slice(0, 2)} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('the dialog button row', () => {
  it('sticks to the bottom of the scrolling body, with Cancel first and a red confirm for a destructive action', () => {
    render(
      <ConfirmDialog title="Move?" confirmLabel="Move anyway" danger onConfirm={vi.fn()} onCancel={vi.fn()}>
        <p>text</p>
      </ConfirmDialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Move?' });
    const buttons = within(dialog).getAllByRole('button').filter((button) => ['Cancel', 'Move anyway'].includes(button.textContent ?? ''));
    expect(buttons.map((button) => button.textContent)).toEqual(['Cancel', 'Move anyway']);
    expect(buttons[0]?.closest('[class*="sticky"]')).not.toBeNull();
    expect(buttons[1]?.className).toContain('bg-danger');
    expect(buttons[0]).toHaveFocus();
  });
});
