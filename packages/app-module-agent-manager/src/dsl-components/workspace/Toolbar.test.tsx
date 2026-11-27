import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UrlParamContext, type UrlParamService } from '@wadeck-app/dsl-ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoticeItem } from '../logic/notices.js';
import { DEFAULT_VIEW_OPTIONS } from '../logic/viewOptions.js';
import { NoticesButton } from '../ui/Notices.js';
import { DEFAULT_UI_VARIANTS, UI_QUESTIONS } from '../logic/uiVariants.js';
import { TrailSlot } from '../ui/TrailSlot.js';
import { Toolbar, type ToolbarProps } from './Toolbar.js';

const service: UrlParamService = { get: () => null, set: () => undefined };
const WARN: NoticeItem = { key: 'w', tone: 'warning', summary: 'Daemon off', details: 'text' };

function props(extra: Partial<ToolbarProps>): ToolbarProps {
  return {
    count: 3,
    hiddenDead: 0,
    show: 'alive',
    onShow: vi.fn(),
    mode: 'tree',
    onMode: vi.fn(),
    options: DEFAULT_VIEW_OPTIONS,
    onOptions: vi.fn(),
    search: { text: '', onText: vi.fn(), shown: 3, total: 3, problems: [], onMove: vi.fn(), onEnter: vi.fn() },
    helpOpen: false,
    onHelpOpenChange: vi.fn(),
    ...extra,
  };
}

// The header is always drawn through the shell header slot (HeaderActions), which a test provides with TrailSlot.
const show = (extra: Partial<ToolbarProps>) =>
  render(
    <UrlParamContext.Provider value={service}>
      <TrailSlot>
        <Toolbar {...props(extra)} />
      </TrailSlot>
    </UrlParamContext.Provider>,
  );

beforeEach(() => window.sessionStorage.clear());

describe('Toolbar notices button', () => {
  it('sits in the right-aligned group of controls, first of them', () => {
    show({ notices: <NoticesButton items={[WARN]} /> });
    const notices = screen.getByRole('button', { name: '1 notice' });
    const slot = notices.closest('[data-notices-slot]')!;
    expect(slot.closest('.ml-auto')).not.toBeNull();
  });

  it('is absent when there is no active notice, and the toolbar has no extra gap slot', () => {
    show({ notices: <NoticesButton items={[]} /> });
    expect(screen.queryByRole('button', { name: /notices?$/ })).toBeNull();
  });

  it('has neither a New group nor a New session button (both are in the footer of the list pane)', () => {
    for (const mode of ['tree', 'custom', 'groups', 'inbox'] as const) {
      const { unmount } = show({ mode, notices: <NoticesButton items={[WARN]} /> });
      expect(screen.queryByRole('button', { name: /new group/i })).toBeNull();
      expect(screen.queryByRole('button', { name: 'New session' })).toBeNull();
      unmount();
    }
  });

  it('has ONE list configuration control, on the left, and none of the old separate ones', () => {
    show({});
    expect(screen.getAllByRole('button', { name: 'List layout and view options' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'View options' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^List mode/ })).toBeNull();
    const actions = document.querySelector('.ml-auto') as HTMLElement;
    expect(actions.contains(screen.getByRole('button', { name: 'List layout and view options' }))).toBe(false);
  });

  it('the Sessions to show select and the icon buttons share one compact size (the base size props, no custom height)', () => {
    show({});
    for (const name of ['Text size', 'Keyboard shortcuts', 'List layout and view options']) {
      const icon = screen.queryByRole('button', { name: new RegExp(name) });
      if (icon !== null) {
        expect(icon.className, name).toMatch(/h-7/);
      }
    }
  });
});

describe('Toolbar search box', () => {
  it('is a flex box and the counter and the clear button live inside it, over the field', () => {
    show({ search: { text: 'zz', onText: vi.fn(), shown: 0, total: 39, problems: [], onMove: vi.fn(), onEnter: vi.fn() } });
    const field = screen.getByRole('textbox', { name: 'Search agents' });
    const box = field.closest('.relative');
    expect(box?.className).toContain('flex');
    expect(box).toContainElement(screen.getByText('0 of 39'));
    expect(box).toContainElement(screen.getByRole('button', { name: 'Clear the search box' }));
  });
});

describe('Toolbar header placement (settled: the breadcrumb row)', () => {
  const inTrail = (extra: Partial<ToolbarProps> = {}) => (
    <UrlParamContext.Provider value={service}>
      <TrailSlot>
        <main data-testid="page">
          <Toolbar {...props(extra)} />
        </main>
      </TrailSlot>
    </UrlParamContext.Provider>
  );

  it('has no dock question any more: the old stored value of ui-header-placement is simply ignored', () => {
    expect(Object.keys(UI_QUESTIONS)).not.toContain('headerPlacement');
    expect(Object.values(UI_QUESTIONS).map((question) => question.id)).not.toContain('ui-header-placement');
    expect(DEFAULT_UI_VARIANTS).not.toHaveProperty('headerPlacement');
  });

  it('renders one h1 through HeaderActions, in the trail slot and not in the page', () => {
    render(inTrail());
    const heading = screen.getByRole('heading', { level: 1, name: 'Agents' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByTestId('trail-slot')).toContainElement(heading);
    expect(screen.getByTestId('page')).not.toContainElement(heading);
    const row = heading.closest('[data-toolbar]') as HTMLElement;
    expect(row.getAttribute('data-placement')).toBe('in-trail');
    expect(row.className).not.toContain('border-b');
    expect(row.className).toContain('min-w-0');
    expect(row.className).toContain('flex-1');
    expect(screen.getByRole('textbox', { name: 'Search agents' })).toBeInTheDocument();
  });

  it('keeps the controls alive (the search field takes typing)', async () => {
    const onText = vi.fn();
    render(inTrail({ search: { text: '', onText, shown: 3, total: 3, problems: [], onMove: vi.fn(), onEnter: vi.fn() } }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Search agents' }), 'a');
    expect(onText).toHaveBeenCalledWith('a');
  });
});
