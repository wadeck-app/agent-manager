import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DetailHeader } from '../detail/DetailHeader.js';
import { groupReasons } from '../logic/adoptSwitch.js';
import { row } from '../logic/fixtures.js';
import { ReasonList, VISIBLE_REASONS } from '../owned/ReasonList.js';
import { stubFetch } from '../owned/testFetch.js';
import { DEFAULT_UI_VARIANTS } from '../logic/uiVariants.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { UiVariantsContext } from './UiVariants.js';

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

  it('shows at most 3 details, then "Show N more" reveals the rest and "Show fewer details" folds them again', async () => {
    render(<ReasonList reasons={REASONS} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(VISIBLE_REASONS);
    // Every group still names itself and says what the move does to it.
    expect(screen.getByRole('heading', { name: 'Waiting for an answer (2)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cannot tell what runs (1)' })).toBeInTheDocument();
    const more = screen.getByRole('button', { name: `Show ${REASONS.length - VISIBLE_REASONS} more` });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(more);
    expect(screen.getAllByRole('listitem')).toHaveLength(REASONS.length);
    await userEvent.click(screen.getByRole('button', { name: 'Show fewer details' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(VISIBLE_REASONS);
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

describe('the detailed header on a phone (the one-line header has no details toggle: the line drops what does not fit)', () => {
  function withMedia(matching: (query: string) => boolean): void {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: matching(query), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  }
  const header = () => {
    stubFetch({});
    return render(
      <UiVariantsContext.Provider value={{ ...DEFAULT_UI_VARIANTS, headerActions: 'detailed' }}>
        <DetailHeader session={row({ sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', displayName: 'one', pid: 12 })} now={2_000_000} busy={false} onBack={vi.fn()} onTogglePin={vi.fn()} onMarkSeen={vi.fn()} onOwnedChange={vi.fn()} onForgotten={vi.fn()} onForked={vi.fn()} onOpenSource={vi.fn()} />
      </UiVariantsContext.Provider>,
    );
  };

  it('keeps the chips closed under 600 px of width, whatever the height', () => {
    withMedia((query) => query.includes('max-width: 599px'));
    const { container } = header();
    expect(container.querySelector('[data-status-chips]')?.className).toContain('hidden');
    expect(screen.getByRole('button', { name: 'Show details' })).toBeInTheDocument();
  });

  it('keeps them open on a big screen', () => {
    withMedia(() => false);
    const { container } = header();
    expect(container.querySelector('[data-status-chips]')?.className).not.toContain('hidden');
  });
});
