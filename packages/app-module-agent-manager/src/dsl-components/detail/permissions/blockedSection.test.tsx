import { fireEvent, render, screen, within } from '@testing-library/react';
import { RouterContext } from '@wadeck-app/dsl-ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// violations-suppress: ts/no-deep-relative test fixtures of the logic folder
import { overview } from '../../logic/permissionsFixtures.js';
import { BLOCKED_RANKING_KEY, permissionsOf, row, type AgentRow } from '../deps.js';

type GuardrailBlocksDto = NonNullable<AgentRow['guardrailBlocks']>;
import { PermissionsPanel } from './PermissionsPanel.js';

const SID = '00000000-0000-4000-8000-000000000001';

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const names = ['rm', 'interpreter-exec', 'git-push', 'git-commit', 'curl-pipe', 'ssh', 'sudo'];
// All time: 7 categories (rm 70 ... sudo 10); the last 30 min: sudo 4, ssh 2, rm 1 (the least blocked of all time are the most recent).
const blocks: GuardrailBlocksDto = {
  total: 280,
  categories: names.map((category, index) => ({ category, count: 70 - index * 10 })),
  timeout: false,
  recent: { total: 7, categories: [{ category: 'sudo', count: 4 }, { category: 'ssh', count: 2 }, { category: 'rm', count: 1 }] },
};

function panel(blocksOf: GuardrailBlocksDto | undefined, navigate = vi.fn()) {
  const session = row({ sessionId: SID, cwd: '/w/shop', ...(blocksOf === undefined ? {} : { guardrailBlocks: blocksOf }) });
  const files = overview([]);
  render(
    <RouterContext.Provider value={{ navigate, back: vi.fn() }}>
      <PermissionsPanel session={session} feed={{ overview: files, view: permissionsOf(files, SID, session.cwd), error: '', loading: false, reload: vi.fn(), cli: { kind: 'missing', text: 'no CLI' } }} />
    </RouterContext.Provider>,
  );
  return navigate;
}

const listed = (): string[] => within(screen.getByRole('region', { name: 'Blocked' }).querySelector('ul') as HTMLElement).getAllByRole('listitem').map((item) => item.querySelector('span')?.textContent ?? '');

describe('the Blocked part of the Permissions tab', () => {
  it('lists the TOP 5 by count and says how many more there are, without drawing them', () => {
    panel(blocks);
    expect(listed()).toEqual(['rm', 'interpreter-exec', 'git-push', 'git-commit', 'curl-pipe']);
    const more = document.querySelector('[data-blocked-more]') as HTMLElement;
    expect(more).toHaveTextContent('2 more categories on the Guardrails page');
    expect(screen.queryByText('sudo')).toBeNull();
  });

  it('the ranking "Last 30 min" lists the categories of the last 30 min, the most blocked first, and no "more" when they fit', () => {
    panel(blocks);
    fireEvent.change(screen.getByRole('combobox', { name: 'Rank the blocked categories' }), { target: { value: 'recent' } });
    expect(listed()).toEqual(['sudo', 'ssh', 'rm']);
    expect(document.querySelector('[data-blocked-more]')).toBeNull();
    expect(window.localStorage.getItem(BLOCKED_RANKING_KEY)).toBe('recent');
  });

  it('the choice is kept: a new panel opens on it', () => {
    window.localStorage.setItem(BLOCKED_RANKING_KEY, 'recent');
    panel(blocks);
    expect(screen.getByRole('combobox', { name: 'Rank the blocked categories' })).toHaveValue('recent');
    expect(listed()).toEqual(['sudo', 'ssh', 'rm']);
  });

  it('a saved value that is not a ranking is said, and the default shows', () => {
    window.localStorage.setItem(BLOCKED_RANKING_KEY, 'bogus');
    panel(blocks);
    expect(screen.getByRole('alert')).toHaveTextContent('The saved ranking "bogus" is not one of count, recent');
    expect(listed()[0]).toBe('rm');
  });

  it('a storage that refuses is said, and the choice still applies until reload', () => {
    panel(blocks);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Rank the blocked categories' }), { target: { value: 'recent' } });
    expect(screen.getByRole('alert')).toHaveTextContent('could not be saved (quota)');
    expect(listed()).toEqual(['sudo', 'ssh', 'rm']);
  });

  it('says so when nothing was blocked in the last 30 min instead of an empty list', () => {
    panel({ ...blocks, recent: { total: 0, categories: [] } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Rank the blocked categories' }), { target: { value: 'recent' } });
    expect(screen.getByText('No category was blocked in the last 30 min.')).toBeInTheDocument();
  });

  it('counters that hold less than the journal: no "0 in total" next to rows, the rows are the journal ones and say their window', () => {
    panel({ total: 0, categories: [], timeout: false, recent: { total: 6, categories: [{ category: 'rm', count: 6 }] } });
    const section = screen.getByRole('region', { name: 'Blocked' });
    expect(section).toHaveTextContent('6 in the last 30 min');
    expect(section).not.toHaveTextContent('in total');
    expect(listed()).toEqual(['rm']);
    expect(within(section).getByRole('list', { name: 'Blocked by category, in the last 30 min' })).toBeInTheDocument();
  });

  it('the link to the Guardrails page navigates inside the app through the router (no reload)', () => {
    const navigate = panel(blocks);
    const buttons = screen.getAllByRole('button', { name: 'Guardrails page' });
    // One at the top of the tab, one under the list.
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1] as HTMLElement);
    expect(navigate).toHaveBeenCalledWith('/modules/agent-manager/guardrails');
  });
});
