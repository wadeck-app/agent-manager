import { render, screen } from '@testing-library/react';
import { UrlParamContext, type UrlParamService } from '@wadeck-app/dsl-ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NoticeItem } from '../logic/notices.js';
import { DEFAULT_VIEW_OPTIONS } from '../logic/viewOptions.js';
import { NoticesButton } from '../ui/Notices.js';
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

const show = (extra: Partial<ToolbarProps>) =>
  render(
    <UrlParamContext.Provider value={service}>
      <Toolbar {...props(extra)} />
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
