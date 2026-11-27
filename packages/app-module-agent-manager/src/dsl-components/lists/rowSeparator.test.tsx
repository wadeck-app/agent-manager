import { UrlParamContext, type UrlParamService } from '@wadeck-app/dsl-ui';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { row } from '../logic/fixtures.js';
import { parseQuery } from '../logic/fuzzy.js';
import { DEFAULT_UI_VARIANTS, ROW_SEPARATOR, UI_QUESTIONS, type RowSeparatorVariant } from '../logic/uiVariants.js';
import { DEFAULT_VIEW_OPTIONS } from '../logic/viewOptions.js';
import type { SubagentDto } from '../shared.js';
import { UiVariantsContext } from '../ui/UiVariants.js';
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

function show(List: (props: ListProps) => React.ReactNode, variant: RowSeparatorVariant, options = List === TreeList ? FLAT : DEFAULT_VIEW_OPTIONS) {
  return render(
    <UiVariantsContext.Provider value={{ ...DEFAULT_UI_VARIANTS, rowSeparator: variant }}>
      <UrlParamContext.Provider value={service}>
        <List sessions={sessions} selectedId={undefined} onSelect={vi.fn()} now={NOW} query={parseQuery('')} searching={false} options={options} marks={{ setMarks: vi.fn() }} />
      </UrlParamContext.Provider>
    </UiVariantsContext.Provider>,
  );
}

// U+00B7 middle dot, U+2022 bullet, U+2219 bullet operator, U+22C5 dot operator, U+2027 hyphenation point, U+30FB katakana middle dot: built from their codes (ASCII source).
const LOOK_ALIKES = new RegExp(`[${[0xb7, 0x2022, 0x2219, 0x22c5, 0x2027, 0x30fb].map((code) => String.fromCharCode(code)).join('')}]`);

describe('the A/B question ui-row-separator', () => {
  it('is in the dock with five options, A Colour and space first and default', () => {
    expect(Object.keys(UI_QUESTIONS.rowSeparator.options)).toEqual([...ROW_SEPARATOR]);
    expect(UI_QUESTIONS.rowSeparator.initial).toBe('space');
    expect(UI_QUESTIONS.rowSeparator.options.space.label).toBe('A Colour and space');
    expect(DEFAULT_UI_VARIANTS.rowSeparator).toBe('space');
  });
});

describe.each([
  ['Tree', TreeList],
  ['Custom', CustomList],
  ['Groups', GroupsList],
  ['Inbox', InboxList],
] as const)('the name and the folder in the %s list', (_mode, List) => {
  it.each(ROW_SEPARATOR)('%s: no middle dot, bullet or look-alike glyph anywhere in the text of the list', (variant) => {
    const { container } = show(List, variant);
    expect(container.querySelectorAll('[data-session-id]').length).toBeGreaterThan(0);
    expect(container.textContent ?? '').not.toMatch(LOOK_ALIKES);
    // A comma for a screen reader between the name and the folder, whatever the look.
    expect(container.textContent ?? '').toMatch(/, (shop|billing-owner)/);
  });
});

describe('the folder text of the Tree rows (Q37)', () => {
  it('is not repeated under the header of its own folder, and is written in the flat tree', () => {
    const grouped = show(TreeList, 'space', DEFAULT_VIEW_OPTIONS);
    expect(grouped.container.querySelectorAll('[data-session-id]').length).toBeGreaterThan(0);
    expect(grouped.container.querySelector('[data-herdr-folder]')).toBeNull();
    grouped.unmount();
    const flat = show(TreeList, 'space');
    expect(flat.container.querySelector('[data-herdr-folder]')).not.toBeNull();
  });
});

describe('the five looks of a Herdr row (Tree)', () => {
  const folderOf = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-herdr-folder]');

  it('A space: muted text after the gap, no rule, no chip, no icon, one line', () => {
    const { container } = show(TreeList, 'space');
    const folder = folderOf(container);
    expect(folder?.textContent).toContain('shop');
    expect(folder?.querySelector('.text-muted-tint')).not.toBeNull();
    expect(container.querySelector('[data-row-rule], [data-row-chip], [data-row-folder-icon], [data-herdr-stack]')).toBeNull();
    expect(folder?.parentElement?.className).toContain('gap-x-2');
  });

  it('B rule: a 1 px, 12 px tall rule inside the folder box, hidden from screen readers', () => {
    const { container } = show(TreeList, 'rule');
    const rule = folderOf(container)?.querySelector<HTMLElement>('[data-row-rule]');
    expect(rule?.className).toContain('w-px');
    expect(rule?.className).toContain('h-3');
    expect(rule).toHaveAttribute('aria-hidden', 'true');
    expect(rule?.textContent).toBe('');
  });

  it('C chip: the folder is in a module Chip of size xs (16 px), no custom colours', () => {
    const { container } = show(TreeList, 'chip');
    const chip = folderOf(container)?.querySelector<HTMLElement>('[data-row-chip]');
    expect(chip?.className).toContain('h-4');
    expect(chip?.className).toContain('border-border');
    expect(chip?.textContent).toBe('shop');
  });

  it('D folder icon: a 12 px muted Folder icon before the text', () => {
    const { container } = show(TreeList, 'folder');
    const icon = folderOf(container)?.querySelector<SVGElement>('[data-row-folder-icon]');
    expect(icon?.getAttribute('class')).toContain('h-3');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    expect(folderOf(container)?.textContent).toContain('shop');
  });

  it('E stacked: two lines (name, then the smaller folder), a 44 px row box', () => {
    const { container } = show(TreeList, 'stacked');
    const stack = container.querySelector<HTMLElement>('[data-herdr-stack]');
    expect(stack?.className).toContain('flex-col');
    expect(stack?.querySelector('[data-herdr-name]')).not.toBeNull();
    expect(folderOf(container)?.className).toContain('text-[11px]');
    const rowBox = container.querySelector<HTMLElement>('[data-session-id]');
    expect(rowBox?.className).toContain('h-[44px]');
    // The fixed right columns are still there, centred by the row (items-center).
    expect(container.querySelector('[data-herdr-age]')).not.toBeNull();
    expect(container.querySelector('[data-row-menu-column]')).not.toBeNull();
    expect(container.querySelector('[data-status-column]')).not.toBeNull();
  });

  it('the other variants keep the 30 px box', () => {
    for (const variant of ['space', 'rule', 'chip', 'folder'] as const) {
      const { container, unmount } = show(TreeList, variant);
      expect(container.querySelector<HTMLElement>('[data-session-id]')?.className).toContain('h-[30px]');
      unmount();
    }
  });

  it.each(['space', 'rule', 'chip', 'folder'] as const)('%s: the name keeps priority, the folder box shrinks and wraps out first', (variant) => {
    const { container } = show(TreeList, variant);
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

describe('the Groups and Inbox rows (folder first, session name second)', () => {
  it('folder icon: the icon goes before the folder, the session name stays plain muted text', () => {
    const { container } = show(GroupsList, 'folder');
    const label = container.querySelector<HTMLElement>('[data-session-id] [data-row-folder-icon]')?.parentElement;
    expect(label?.firstElementChild).toHaveAttribute('data-row-folder-icon');
    expect(label?.querySelectorAll('[data-row-folder-icon]')).toHaveLength(1);
  });

  it('stacked: the folder above the session name, in a column', () => {
    const { container } = show(GroupsList, 'stacked');
    expect(container.querySelector('[data-session-id] [data-herdr-stack]')?.className).toContain('flex-col');
  });
});

describe('the sub-agent rows', () => {
  const node: SubagentDto = { agentId: 'a1', name: 'reviewer-1', agentType: 'code-review', finished: true, children: [] } as unknown as SubagentDto;

  it.each(ROW_SEPARATOR)('%s: no look-alike glyph, and the type is read after a comma', (variant) => {
    const { container } = render(
      <UiVariantsContext.Provider value={{ ...DEFAULT_UI_VARIANTS, rowSeparator: variant }}>
        <SubagentRowNode node={node} depth={0} />
      </UiVariantsContext.Provider>,
    );
    expect(container.textContent ?? '').not.toMatch(LOOK_ALIKES);
    expect(container.textContent ?? '').toContain('reviewer-1, code-review');
  });
});
