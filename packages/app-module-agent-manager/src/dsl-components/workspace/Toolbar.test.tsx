import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HeaderActionsProvider, HeaderActionsSlot, UrlParamContext, type UrlParamService } from '@wadeck-app/dsl-ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoticeItem } from '../logic/notices.js';
import { DEFAULT_VIEW_OPTIONS } from '../logic/viewOptions.js';
import { NoticesButton } from '../ui/Notices.js';
import { DEFAULT_UI_VARIANTS, UI_QUESTIONS } from '../logic/uiVariants.js';
import { UiVariantsContext } from '../ui/UiVariants.js';
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

// The tests of the controls render the in-page header (the default is the breadcrumb row, tested below with its own slot).
const IN_PAGE = { ...DEFAULT_UI_VARIANTS, headerPlacement: 'in-page' as const };

const show = (extra: Partial<ToolbarProps>) =>
  render(
    <UrlParamContext.Provider value={service}>
      <UiVariantsContext.Provider value={IN_PAGE}>
        <Toolbar {...props(extra)} />
      </UiVariantsContext.Provider>
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

describe('Toolbar header placement (A/B question ui-header-placement)', () => {
  const inPage = (extra: Partial<ToolbarProps> = {}) => (
    <UrlParamContext.Provider value={service}>
      <UiVariantsContext.Provider value={IN_PAGE}>
        <Toolbar {...props(extra)} />
      </UiVariantsContext.Provider>
    </UrlParamContext.Provider>
  );
  // The default of the question: no override of the variants.
  const inTrail = (extra: Partial<ToolbarProps> = {}) => (
    <UrlParamContext.Provider value={service}>
      <UiVariantsContext.Provider value={DEFAULT_UI_VARIANTS}>
        <HeaderActionsProvider>
          <header data-testid="trail">
            <HeaderActionsSlot />
          </header>
          <main data-testid="page">
            <Toolbar {...props(extra)} />
          </main>
        </HeaderActionsProvider>
      </UiVariantsContext.Provider>
    </UrlParamContext.Provider>
  );

  it('the default is in-trail (the breadcrumb row), the other option is in-page', () => {
    expect(UI_QUESTIONS.headerPlacement.initial).toBe('in-trail');
    expect(DEFAULT_UI_VARIANTS.headerPlacement).toBe('in-trail');
    expect(Object.keys(UI_QUESTIONS.headerPlacement.options)).toEqual(['in-trail', 'in-page']);
    expect(UI_QUESTIONS.headerPlacement.options['in-trail'].hint).toContain('The default');
    expect(UI_QUESTIONS.headerPlacement.options['in-page'].hint).not.toContain('Today');
  });

  it('in-page renders one h1 and the bordered row in the page', () => {
    render(inPage());
    expect(screen.getAllByRole('heading', { level: 1, name: 'Agents' })).toHaveLength(1);
    const row = document.querySelector('[data-toolbar]') as HTMLElement;
    expect(row.className).toContain('border-b');
    expect(row.hasAttribute('data-placement')).toBe(false);
  });

  it('in-trail (the default) renders one h1 through HeaderActions, in the trail slot and not in the page', () => {
    render(inTrail());
    const heading = screen.getByRole('heading', { level: 1, name: 'Agents' });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByTestId('trail')).toContainElement(heading);
    expect(screen.getByTestId('page')).not.toContainElement(heading);
    const row = heading.closest('[data-toolbar]') as HTMLElement;
    expect(row.getAttribute('data-placement')).toBe('in-trail');
    expect(row.className).not.toContain('border-b');
    expect(row.className).toContain('min-w-0');
    expect(row.className).toContain('flex-1');
    expect(screen.getByRole('textbox', { name: 'Search agents' })).toBeInTheDocument();
  });

  it('in-trail keeps the controls alive (the search field takes typing)', async () => {
    const onText = vi.fn();
    render(inTrail({ search: { text: '', onText, shown: 3, total: 3, problems: [], onMove: vi.fn(), onEnter: vi.fn() } }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Search agents' }), 'a');
    expect(onText).toHaveBeenCalledWith('a');
  });
});
