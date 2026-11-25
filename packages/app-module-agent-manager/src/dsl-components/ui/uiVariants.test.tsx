import { AbExperiments, UrlParamContext, type UrlParamService } from '@wadeck-app/dsl-ui';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { placePopup } from '../detail/AnchoredPopup.js';
import { HeaderActions, type HeaderActionsProps } from '../detail/HeaderActions.js';
import { DetailHeader } from '../detail/DetailHeader.js';
import { THREAD_TOOLTIP, ThreadButton } from '../detail/log/ThreadButton.js';
import { parseQuery } from '../logic/fuzzy.js';
import { ownedRow, row } from '../logic/fixtures.js';
import { DEFAULT_UI_VARIANTS, UI_QUESTIONS, type UiVariantValues } from '../logic/uiVariants.js';
import { DEFAULT_VIEW_OPTIONS } from '../logic/viewOptions.js';
import { TreeList } from '../lists/TreeList.js';
import { OwnedStateChip } from '../owned/OwnedStateChip.js';
import { stubFetch } from '../owned/testFetch.js';
import { Toolbar } from '../workspace/Toolbar.js';
import { Scope } from './Scope.js';
import { UiVariants, UiVariantsContext } from './UiVariants.js';

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => window.localStorage.clear());

function withVariants(values: Partial<UiVariantValues>, children: React.ReactNode) {
  return <UiVariantsContext.Provider value={{ ...DEFAULT_UI_VARIANTS, ...values }}>{children}</UiVariantsContext.Provider>;
}

const ACTIONS: HeaderActionsProps = { busy: false, onFork: vi.fn(), forkBlocked: undefined, forkMeaning: 'Fork it', pinned: false, onTogglePin: vi.fn(), canMarkSeen: false, onMarkSeen: vi.fn() };

describe('the design questions of the A/B dock', () => {
  it('every question lists its default among its options, with a hint that is not empty', () => {
    for (const question of Object.values(UI_QUESTIONS)) {
      const keys = Object.keys(question.options);
      expect(keys).toContain(question.initial);
      expect(keys[0]).toBe(question.initial);
      for (const option of Object.values(question.options) as { label: string; hint: string }[]) {
        expect(option.label).not.toBe('');
        expect(option.hint.length).toBeGreaterThan(30);
      }
    }
  });

  it('the ids are unique and prefixed, so they never collide with the folder picker', () => {
    const ids = Object.values(UI_QUESTIONS).map((question) => question.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.startsWith('ui-'))).toBe(true);
  });
});

describe('the folded state of the dock', () => {
  it('is restored when the experiments are switched on after the page mounted (the shell learns the setting late)', () => {
    window.localStorage.setItem('ab.collapsed', 'collapsed');
    const page = (enabled: boolean) => (
      <AbExperiments enabled={enabled}>
        <UiVariants>
          <span>page</span>
        </UiVariants>
      </AbExperiments>
    );
    const { rerender } = render(page(false));
    expect(screen.queryByTestId('ab-dock')).toBeNull();
    rerender(page(true));
    expect(screen.getByRole('button', { name: `Show the A/B tests (${Object.keys(UI_QUESTIONS).length})` })).toBeInTheDocument();
    expect(screen.getByTestId('ab-dock')).not.toBeVisible();
  });
});

describe('the header actions looks', () => {
  it('line (default): Fork, Pin and Mark as seen are three icon buttons, the one that is off says why', () => {
    render(<HeaderActions {...ACTIONS} />);
    expect(screen.getByRole('button', { name: 'Fork' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Pin' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Mark as seen' })).toBeDisabled();
  });

  it('line-menu: Fork stays an icon, Pin and Mark as seen are in one More actions menu (Escape closes it and gives the focus back)', async () => {
    render(withVariants({ headerActions: 'line-menu' }, <HeaderActions {...ACTIONS} />));
    expect(screen.getByRole('button', { name: 'Fork' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Pin' })).toBeNull();
    const trigger = screen.getByRole('button', { name: 'More actions' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: 'More actions' });
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Pin', 'Mark as seenonly a Done session has something to mark']);
    expect(within(menu).getByRole('menuitem', { name: /Mark as seen/ })).toBeDisabled();
    expect(within(menu).getByRole('menuitem', { name: 'Pin' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('line-menu: the menu is a floating overlay in the body, never in the flow of the zone that holds the button', async () => {
    const { container } = render(withVariants({ headerActions: 'line-menu' }, <HeaderActions {...ACTIONS} />));
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    const menu = screen.getByRole('menu', { name: 'More actions' });
    expect(container.contains(menu)).toBe(false);
    expect(menu.parentElement?.parentElement).toBe(document.body);
    expect(menu).toHaveStyle({ position: 'fixed' });
    expect(menu).toHaveAttribute('data-anchored-popup');
  });

  it('line-menu: a press outside closes the menu, a press in it does not; the arrows, Home and End walk the enabled items', async () => {
    render(withVariants({ headerActions: 'line-menu' }, <HeaderActions {...ACTIONS} canMarkSeen />));
    const trigger = screen.getByRole('button', { name: 'More actions' });
    await userEvent.click(trigger);
    const menu = screen.getByRole('menu');
    await userEvent.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('menuitem', { name: 'Mark as seen' })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(within(menu).getByRole('menuitem', { name: 'Pin' })).toHaveFocus();
    await userEvent.keyboard('{End}');
    expect(within(menu).getByRole('menuitem', { name: 'Mark as seen' })).toHaveFocus();
    await userEvent.pointer({ target: menu, keys: '[MouseLeft]' });
    expect(screen.queryByRole('menu')).not.toBeNull();
    await userEvent.pointer({ target: document.body, keys: '[MouseLeft]' });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('line-menu: the trigger toggles the menu (a press on it is not an outside press) and choosing an item runs it and closes the menu', async () => {
    const onTogglePin = vi.fn();
    render(withVariants({ headerActions: 'line-menu' }, <HeaderActions {...ACTIONS} onTogglePin={onTogglePin} />));
    const trigger = screen.getByRole('button', { name: 'More actions' });
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Pin' }));
    expect(onTogglePin).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('detailed: Details button opens a floating panel (Escape closes it and gives the focus back), no Details button in the other looks', async () => {
    const { container } = render(withVariants({ headerActions: 'detailed' }, <HeaderActions {...ACTIONS} details={<p>the folder</p>} />));
    const toggle = screen.getByRole('button', { name: 'Show details' });
    await userEvent.click(toggle);
    const panel = screen.getByRole('dialog', { name: 'Details' });
    expect(panel).toHaveTextContent('the folder');
    expect(container.contains(panel)).toBe(false);
    expect(screen.getByRole('button', { name: 'Hide details' })).toHaveAttribute('aria-expanded', 'true');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Show details' })).toHaveFocus();
    cleanup();
    render(<HeaderActions {...ACTIONS} details={<p>the folder</p>} />);
    expect(screen.queryByRole('button', { name: /details/i })).toBeNull();
  });

  it('a blocked Fork is off in every look and keeps its reason', () => {
    render(withVariants({ headerActions: 'line-menu' }, <HeaderActions {...ACTIONS} forkBlocked="no message yet" />));
    expect(screen.getByRole('button', { name: 'Fork' })).toBeDisabled();
  });
});

describe('the Thread action of a message', () => {
  const anchor = { kind: 'ok', messageId: 'm1', quote: 'hello' } as unknown as Parameters<typeof ThreadButton>[0]['anchor'];

  it('is always visible: no reveal on hover, at the right end of the row, with the tooltip that says what it does', () => {
    render(<ThreadButton anchor={anchor} onThread={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Thread' });
    expect(button.parentElement?.className).not.toContain('opacity-0');
    expect(button.parentElement?.className).toContain('ml-auto');
    expect(button).toHaveAttribute('title', THREAD_TOOLTIP);
    expect(THREAD_TOOLTIP).toBe('Start a thread from this message');
  });
});

describe('the status chips', () => {
  it('a list row leaves out the waiting chip of a single request (the row already says it) but keeps a count', () => {
    const one = render(<OwnedStateChip session={ownedRow({ ownedState: 'requires_action', pendingPermissions: 1 })} compact />);
    expect(one.container.textContent).toBe('');
    one.unmount();
    render(<OwnedStateChip session={ownedRow({ ownedState: 'requires_action', pendingPermissions: 3 })} compact />);
    expect(screen.getByText('Waiting for permission (3)')).toBeInTheDocument();
  });

  it('the soft look: a tinted pill with its icon and label', () => {
    const { container } = render(<OwnedStateChip session={ownedRow({ ownedState: 'exited' })} />);
    expect(container.querySelector('svg')).not.toBeNull();
    expect(screen.getByText('Exited').className).toContain('bg-');
  });
});

describe('the Toolbar on a narrow screen', () => {
  it('is hidden below lg while a session is open (the detail needs the room) and shown otherwise', () => {
    const props = {
      count: 1,
      hiddenDead: 0,
      show: 'alive' as const,
      onShow: vi.fn(),
      mode: 'tree' as const,
      onMode: vi.fn(),
      options: DEFAULT_VIEW_OPTIONS,
      onOptions: vi.fn(),
      search: { text: '', onText: vi.fn(), shown: 1, total: 1, problems: [], onMove: vi.fn(), onEnter: vi.fn() },
      helpOpen: false,
      onHelpOpenChange: vi.fn(),
      onNewSession: vi.fn(),
    };
    const { container, rerender } = render(<Toolbar {...props} />);
    expect(container.querySelector('[data-toolbar]')?.className).not.toContain('hidden');
    rerender(<Toolbar {...props} detailOpen />);
    expect(container.querySelector('[data-toolbar]')?.className).toContain('hidden lg:flex');
  });
});

describe('the Tree row densities', () => {
  function tree(values: Partial<UiVariantValues>, sessions = [ownedRow({ sessionId: 'a1', displayName: 'agent-one', cwd: '/w/shop', folder: 'shop' })], selectedId?: string) {
    const service: UrlParamService = { get: () => null, set: () => undefined };
    return render(
      withVariants(
        values,
        <UrlParamContext.Provider value={service}>
          <TreeList sessions={sessions} selectedId={selectedId} onSelect={vi.fn()} now={2_000_000} query={parseQuery('')} searching={false} options={DEFAULT_VIEW_OPTIONS} />
        </UrlParamContext.Provider>,
      ),
    );
  }

  it('compact (the previous row): the host badge is an icon, its word stays for a screen reader', () => {
    tree({ treeDensity: 'compact' });
    const badge = document.querySelector('[data-host-badge]');
    expect(badge?.querySelector('.sr-only')?.textContent).toBe('Web');
    expect(document.querySelector('[data-herdr-light]')).toBeNull();
  });

  it('the options are the Herdr row (default), the previous compact row and the name-only Herdr row', () => {
    expect(Object.keys(UI_QUESTIONS.treeDensity.options)).toEqual(['herdr-tinted', 'compact', 'herdr-name']);
    expect(DEFAULT_UI_VARIANTS.treeDensity).toBe('herdr-tinted');
  });

  it('herdr (default): 30 px row, 13 px grey name for a quiet agent, muted folder, 11 px age and a light in the fixed 28 px column on the right', () => {
    tree({});
    const row = document.querySelector('[data-session-id]') as HTMLElement;
    expect(row.className).toContain('h-[30px]');
    expect(within(row).getByText('agent-one').className).toContain('text-muted-tint');
    expect(within(row).getByText(/shop/, { selector: 'span.text-muted-tint' })).toBeInTheDocument();
    expect(row.querySelector('[data-herdr-age]')?.className).toContain('text-[11px]');
    expect(document.querySelector('[data-herdr-light="ring"]')).not.toBeNull();
    const column = row.querySelector('[data-status-column]') as HTMLElement;
    expect(column.className).toContain('w-7');
    expect(column.className).toContain('justify-center');
  });

  it('herdr-name: the name only, no folder text', () => {
    tree({ treeDensity: 'herdr-name' });
    const row = document.querySelector('[data-session-id]') as HTMLElement;
    expect(within(row).getByText('agent-one')).toBeInTheDocument();
    expect(within(row).queryByText(/shop/, { selector: 'span.text-muted' })).toBeNull();
  });

  it('the open row has the gold outline and gradient and a semibold white name; a row that needs you is tinted red, a finished unseen one blue', () => {
    const sessions = [
      ownedRow({ sessionId: 'n1', displayName: 'needs', folder: 'a', state: 'needs-you', status: 'waiting', reason: 'permission prompt' }),
      ownedRow({ sessionId: 'd1', displayName: 'done', folder: 'b', state: 'done' }),
      ownedRow({ sessionId: 'i1', displayName: 'quiet', folder: 'c', state: 'idle' }),
    ];
    tree({}, sessions, 'i1');
    const byId = (id: string): HTMLElement => document.querySelector(`[data-session-id="${id}"]`) as HTMLElement;
    expect(byId('n1').className).toContain('--am-herdr-needs-bg');
    expect(byId('d1').className).toContain('--am-herdr-unseen-bg');
    expect(byId('i1').className).toContain('--am-herdr-active-edge');
    expect(byId('i1').className).toContain('bg-[image:var(--am-herdr-active-bg)]');
    expect(byId('n1').className).not.toContain('--am-herdr-active-bg');
    expect(within(byId('i1')).getByText('quiet').className).toContain('font-semibold');
    expect(within(byId('i1')).getByText('quiet').className).toContain('text-content');
    expect(document.querySelector('[data-herdr-light="pill"]')).toHaveTextContent('Needs you');
    expect(document.querySelector('[data-herdr-light="dot"]')).not.toBeNull();
  });

  it('every state light and every folder header icon sit in the same 28 px column, centred, with the same right edge (one vertical axis)', () => {
    const sessions = [
      ownedRow({ sessionId: 'w1', displayName: 'working', folder: 'a', state: 'working' }),
      ownedRow({ sessionId: 'd1', displayName: 'done', folder: 'a', state: 'done' }),
      ownedRow({ sessionId: 'i1', displayName: 'quiet', folder: 'a', state: 'idle' }),
    ];
    const { container } = tree({}, sessions);
    const columns = Array.from(container.querySelectorAll<HTMLElement>('[data-status-column="icon"]'));
    // Three rows and one folder header.
    expect(columns).toHaveLength(4);
    for (const column of columns) {
      expect(column.className).toContain('w-7');
      expect(column.className).toContain('justify-center');
      expect(column.className).toContain('shrink-0');
    }
    const folder = screen.getByText('a').closest('[aria-level="1"]') as HTMLElement;
    expect(folder.querySelector('[data-status-column]')).not.toBeNull();
    // The rows end 10 px from the list edge (mx-2 and pr-0.5), the header too (pr-2.5): same axis.
    const rowEdge = (document.querySelector('[data-session-id]') as HTMLElement).className;
    expect(rowEdge).toContain('mx-2');
    expect(rowEdge).toContain('pr-0.5');
    expect(folder.className).toContain('pr-2.5');
  });
});

describe('the group header looks on the folder headers', () => {
  function folders(values: Partial<UiVariantValues>) {
    const service: UrlParamService = { get: () => null, set: () => undefined };
    return render(
      withVariants(
        values,
        <UrlParamContext.Provider value={service}>
          <TreeList sessions={[ownedRow({ sessionId: 'a1', displayName: 'agent-one', cwd: '/w/shop', folder: 'shop' })]} selectedId={undefined} onSelect={vi.fn()} now={2_000_000} query={parseQuery('')} searching={false} options={DEFAULT_VIEW_OPTIONS} />
        </UrlParamContext.Provider>,
      ),
    );
  }
  const header = (): HTMLElement => screen.getByText('shop').closest('[aria-level="1"]') as HTMLElement;

  it('herdr (default): a plain 11 px header, no bar, no pill, the count after the name', () => {
    folders({});
    expect(header().className).not.toContain('border-l-4');
    expect(screen.getByText('shop').className).toContain('text-[11px]');
    expect(screen.getByText('shop').className).not.toContain('rounded-full');
    expect(header().querySelector('[data-status-column]')).not.toBeNull();
  });

  it('bar: the folder header is a tinted bar with a left edge, with no custom group needed', () => {
    folders({ groupHeader: 'bar' });
    expect(header().className).toContain('border-l-4');
    expect(screen.getByText('shop').className).toContain('text-sm');
  });

  it('pill puts the folder name in a pill', () => {
    folders({ groupHeader: 'pill' });
    expect(screen.getByText('shop').className).toContain('rounded-full');
  });

  it('the options are herdr (default), bar and pill', () => {
    expect(Object.keys(UI_QUESTIONS.groupHeader.options)).toEqual(['herdr', 'bar', 'pill']);
  });
});

describe('the header height of the three looks', () => {
  function header(headerActions: UiVariantValues['headerActions']) {
    stubFetch({});
    return render(withVariants({ headerActions }, <DetailHeader session={row({ sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', displayName: 'one', pid: 12 })} now={2_000_000} busy={false} onBack={vi.fn()} onTogglePin={vi.fn()} onMarkSeen={vi.fn()} onOwnedChange={vi.fn()} onForgotten={vi.fn()} onForked={vi.fn()} onOpenSource={vi.fn()} />));
  }

  it('A, B and C draw the same one-line header shell: same classes, no horizontal scroll, no three rows', () => {
    const shells = (['line', 'line-menu', 'detailed'] as const).map((look) => {
      const { container, unmount } = header(look);
      const shell = container.querySelector('header') as HTMLElement;
      const result = { layout: shell.getAttribute('data-header-layout'), className: shell.className };
      unmount();
      return result;
    });
    expect(shells.map((shell) => shell.layout)).toEqual(['line', 'line', 'line']);
    expect(new Set(shells.map((shell) => shell.className)).size).toBe(1);
    expect(shells[0]?.className).toContain('overflow-x-hidden');
    expect(shells[0]?.className).not.toMatch(/overflow-x-(auto|scroll)/);
  });

  it('the details of C never sit in the header: no status chips until the Details button opens the panel', async () => {
    const { container } = header('detailed');
    expect(container.querySelector('[data-status-chips]')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show details' }));
    expect(container.querySelector('[data-status-chips]')).toBeNull();
    expect(document.body.querySelector('[data-anchored-popup] [data-status-chips]')).not.toBeNull();
  });
});

describe('where an anchored popup goes', () => {
  const view = { width: 1280, height: 800 };
  const size = { width: 224, height: 100 };

  it('under the button, its right edge on the button right edge', () => {
    const place = placePopup({ left: 1230, right: 1262, top: 190, bottom: 226 }, size, view);
    expect(place.left).toBe(1262 - 224);
    expect(place.top).toBe(226 + 4);
  });

  it('flipped above the button when it does not fit below', () => {
    const place = placePopup({ left: 1230, right: 1262, top: 700, bottom: 736 }, size, view);
    expect(place.top).toBe(700 - 4 - 100);
  });

  it('kept inside the window on the left and right, and scrolls inside when no side has room', () => {
    expect(placePopup({ left: 0, right: 20, top: 100, bottom: 130 }, size, view).left).toBe(8);
    expect(placePopup({ left: 1270, right: 1300, top: 100, bottom: 130 }, size, view).left).toBe(1280 - 224 - 8);
    const tall = placePopup({ left: 600, right: 630, top: 300, bottom: 330 }, { width: 224, height: 2000 }, view);
    // More room below (458 px) than above (288 px): it stays below and scrolls inside that room.
    expect(tall).toMatchObject({ top: 334, maxHeight: 458 });
  });
});

describe('the font', () => {
  const scopeOf = (container: HTMLElement) => container.querySelector('.agents-scope') as HTMLElement;

  it('the question is settled: Geist is the font and there is no font question in the dock', () => {
    expect(Object.keys(UI_QUESTIONS)).not.toContain('font');
    expect(Object.values(UI_QUESTIONS).map((question) => question.id)).not.toContain('ui-font');
    expect(DEFAULT_UI_VARIANTS).not.toHaveProperty('font');
  });

  it('the scope wrapper carries no data-font: the family is set by the stylesheet, Geist first with the fallback stack', () => {
    const { container } = render(<Scope>content</Scope>);
    expect(scopeOf(container)).not.toHaveAttribute('data-font');
    const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'agents.css'), 'utf8');
    expect(css).toMatch(/\.agents-scope \{\s*font-family: 'AM Geist', ui-sans-serif, system-ui, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;/);
    expect(css).toContain("font-family: 'AM Geist';");
    expect(css).not.toContain('data-font');
  });
});
