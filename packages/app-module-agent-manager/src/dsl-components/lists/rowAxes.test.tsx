import { UrlParamContext, type UrlParamService } from '@wadeck-app/dsl-ui';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { parseQuery } from '../logic/fuzzy.js';
import { row } from '../logic/fixtures.js';
import { DEFAULT_VIEW_OPTIONS } from '../logic/viewOptions.js';
import type { ListProps } from './common.js';
import { GroupsList } from './GroupsList.js';
import { InboxList } from './InboxList.js';

const NOW = 2_000_000;
const service: UrlParamService = { get: () => null, set: () => undefined };

// A mix of marks on purpose: the age and the button must not move with them.
const sessions = [
  row({ folder: 'billing', displayName: 'billing-owner', state: 'needs-you', reason: 'permission prompt', statusUpdatedAt: NOW - 600_000, flagged: true, pinned: true }),
  row({ folder: 'docs', displayName: 'docs-writer', state: 'done', statusUpdatedAt: NOW - 120_000 }),
  row({ folder: 'task', displayName: 'task-owner', state: 'working', statusUpdatedAt: NOW - 180_000, lastActivity: 'Bash: npm test' }),
  row({ folder: 'queue', displayName: 'queue-owner', state: 'idle', statusUpdatedAt: NOW - 90_000_000 }),
];

function show(List: (props: ListProps) => React.ReactNode) {
  return render(
    <UrlParamContext.Provider value={service}>
      <List sessions={sessions} selectedId={undefined} onSelect={vi.fn()} now={NOW} query={parseQuery('')} searching={false} options={DEFAULT_VIEW_OPTIONS} marks={{ setMarks: vi.fn() }} />
    </UrlParamContext.Provider>,
  );
}

/*
 * jsdom has no layout, so the axes are checked on their cause: the age and the "..." button of every row sit in fixed width columns, in ONE line that never
 * wraps (a wrapping line was what moved the ages), in the same order. The real x of the columns is measured with agent-browser (research/ui-audit.md).
 */
describe.each([
  ['Groups', GroupsList],
  ['Inbox', InboxList],
] as const)('the right side of a %s row', (_name, List) => {
  it('is one non wrapping line: age in a fixed column, then the "..." column, for every row', () => {
    const { container } = show(List);
    const rows = [...container.querySelectorAll<HTMLElement>('[data-session-id]')];
    // Inbox lists the rows of its first tab only (the ones that need you).
    expect(rows.length).toBeGreaterThan(0);
    for (const item of rows) {
      const age = item.querySelector<HTMLElement>('[data-herdr-age]');
      const column = item.querySelector<HTMLElement>('[data-row-menu-column]');
      expect(age?.className).toContain('w-8');
      expect(column?.className).toContain('w-6');
      expect(age?.parentElement?.className ?? '').not.toContain('flex-wrap');
      expect(age?.compareDocumentPosition(column as HTMLElement)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      // the same line: the age and the button share their line.
      expect(age?.closest('div.flex')).toBe(column?.closest('div.flex'));
    }
  });

});
