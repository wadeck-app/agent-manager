import { UrlParamContext, type UrlParamService } from '@wadeck-app/dsl-ui';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { row } from '../logic/fixtures.js';
import { parseQuery } from '../logic/fuzzy.js';
import { UI_QUESTIONS } from '../logic/uiVariants.js';
import { DEFAULT_VIEW_OPTIONS } from '../logic/viewOptions.js';
import type { SubagentDto } from '../shared.js';
import type { ListProps } from './common.js';
import { CustomList } from './CustomList.js';
import { GroupsList } from './GroupsList.js';
import { InboxList } from './InboxList.js';
import { SubagentRowNode } from './SubagentRowNode.js';
import { TreeList } from './TreeList.js';

const NOW = 2_000_000;
const service: UrlParamService = { get: () => null, set: () => undefined };
const sessions = [
  row({ folder: 'shop', cwd: '/a/shop', displayName: 'billing-owner', state: 'needs-you', reason: 'permission prompt', statusUpdatedAt: NOW - 600_000 }),
  row({ folder: 'docs', cwd: '/a/docs', displayName: 'a-very-long-session-name-that-needs-an-ellipsis', state: 'done', statusUpdatedAt: NOW - 120_000 }),
  row({ folder: 'task', cwd: '/a/task', displayName: 'task-owner', state: 'working', statusUpdatedAt: NOW - 180_000 }),
];

// The Tree under its folder headers does not repeat the folder on the row (Q37): these tests are about the row text, so the Tree is the flat one here.
const FLAT = { ...DEFAULT_VIEW_OPTIONS, tree: { ...DEFAULT_VIEW_OPTIONS.tree, grouping: 'none' as const } };

function show(List: (props: ListProps) => React.ReactNode, options = List === TreeList ? FLAT : DEFAULT_VIEW_OPTIONS) {
  return render(
    <UrlParamContext.Provider value={service}>
      <List sessions={sessions} selectedId={undefined} onSelect={vi.fn()} now={NOW} query={parseQuery('')} searching={false} options={options} marks={{ setMarks: vi.fn() }} />
    </UrlParamContext.Provider>,
  );
}

// U+00B7 middle dot, U+2022 bullet, U+2219 bullet operator, U+22C5 dot operator, U+2027 hyphenation point, U+30FB katakana middle dot: built from their codes (ASCII source).
const LOOK_ALIKES = new RegExp(`[${[0xb7, 0x2022, 0x2219, 0x22c5, 0x2027, 0x30fb].map((code) => String.fromCharCode(code)).join('')}]`);

describe('the name and the folder of a row (settled: colour and space)', () => {
  it('is no longer a question of the dock', () => {
    expect(Object.keys(UI_QUESTIONS)).not.toContain('rowSeparator');
    expect(Object.values(UI_QUESTIONS).map((question) => question.id)).not.toContain('ui-row-separator');
  });
});

describe.each([
  ['Tree', TreeList],
  ['Custom', CustomList],
  ['Groups', GroupsList],
  ['Inbox', InboxList],
] as const)('the name and the folder in the %s list', (_mode, List) => {
  it('no middle dot, bullet or look-alike glyph anywhere in the text of the list, no rule, chip, icon or second line', () => {
    const { container } = show(List);
    expect(container.querySelectorAll('[data-session-id]').length).toBeGreaterThan(0);
    expect(container.textContent ?? '').not.toMatch(LOOK_ALIKES);
    // A comma for a screen reader between the name and the folder.
    expect(container.textContent ?? '').toMatch(/, (shop|billing-owner)/);
    expect(container.querySelector('[data-row-rule], [data-row-chip], [data-row-folder-icon], [data-herdr-stack]')).toBeNull();
  });
});

describe('the folder text of the Tree rows (Q37)', () => {
  it('is not repeated under the header of its own folder, and is written in the flat tree', () => {
    const grouped = show(TreeList, DEFAULT_VIEW_OPTIONS);
    expect(grouped.container.querySelectorAll('[data-session-id]').length).toBeGreaterThan(0);
    expect(grouped.container.querySelector('[data-herdr-folder]')).toBeNull();
    grouped.unmount();
    const flat = show(TreeList);
    expect(flat.container.querySelector('[data-herdr-folder]')).not.toBeNull();
  });
});

describe('a Herdr row (Tree)', () => {
  const folderOf = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-herdr-folder]');

  it('the folder is muted text after the gap, on one 30 px line', () => {
    const { container } = show(TreeList);
    const folder = folderOf(container);
    expect(folder?.textContent).toContain('shop');
    expect(folder?.querySelector('.text-muted-tint')).not.toBeNull();
    expect(folder?.parentElement?.className).toContain('gap-x-2');
    expect(container.querySelector<HTMLElement>('[data-session-id]')?.className).toContain('h-[30px]');
  });

  it('the name keeps priority, the folder box shrinks and wraps out first', () => {
    const { container } = show(TreeList);
    const name = container.querySelector<HTMLElement>('[data-herdr-name]');
    const folder = folderOf(container);
    expect(name?.className).toContain('max-w-full');
    expect(name?.className).toContain('truncate');
    expect(name?.className).not.toContain('shrink-0');
    expect(folder?.className).toContain('shrink');
    expect(folder?.className).toMatch(/min-w-\[\d+ch\]/);
    expect(name?.parentElement?.className).toContain('flex-wrap');
    expect(name?.parentElement?.className).toContain('overflow-hidden');
  });
});

describe('the sub-agent rows', () => {
  const node: SubagentDto = { agentId: 'a1', name: 'reviewer-1', agentType: 'code-review', finished: true, children: [] } as unknown as SubagentDto;

  it('no look-alike glyph, and the type is read after a comma', () => {
    const { container } = render(<SubagentRowNode node={node} depth={0} />);
    expect(container.textContent ?? '').not.toMatch(LOOK_ALIKES);
    expect(container.textContent ?? '').toContain('reviewer-1, code-review');
  });
});
