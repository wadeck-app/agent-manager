import { AbExperiments, UrlParamContext, type UrlParamService } from '@wadeck-app/dsl-ui';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeaderActions, type HeaderActionsProps } from '../detail/HeaderActions.js';
import { DetailHeader } from '../detail/DetailHeader.js';
import { ThreadButton } from '../detail/log/ThreadButton.js';
import { parseQuery } from '../logic/fuzzy.js';
import { ownedRow, row } from '../logic/fixtures.js';
import { DEFAULT_UI_VARIANTS, UI_QUESTIONS, type UiVariantValues } from '../logic/uiVariants.js';
import { DEFAULT_VIEW_OPTIONS } from '../logic/viewOptions.js';
import { TreeList } from '../lists/TreeList.js';
import { OwnedStateChip } from '../owned/OwnedStateChip.js';
import { stubFetch } from '../owned/testFetch.js';
import { Toolbar } from '../workspace/Toolbar.js';
import { chipSkin } from './chipSkin.js';
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
  it('inline: Fork, Pin and Mark as seen are three buttons, the disabled one says why', () => {
    render(<HeaderActions {...ACTIONS} />);
    expect(screen.getByRole('button', { name: 'Fork' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Pin' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Mark as seen' })).toBeDisabled();
  });

  it('menu: one More actions button; its menu holds the three actions, Escape closes it and gives the focus back', async () => {
    const onFork = vi.fn();
    render(withVariants({ headerActions: 'menu' }, <HeaderActions {...ACTIONS} onFork={onFork} />));
    expect(screen.queryByRole('button', { name: 'Fork' })).toBeNull();
    const trigger = screen.getByRole('button', { name: 'More actions' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: 'More actions' });
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Fork', 'Pin', 'Mark as seenonly a Done session has something to mark']);
    // The disabled action explains itself in the menu, and is skipped by the keyboard.
    expect(within(menu).getByRole('menuitem', { name: /Mark as seen/ })).toBeDisabled();
    expect(within(menu).getByRole('menuitem', { name: 'Fork' })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(within(menu).getByRole('menuitem', { name: 'Pin' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'Fork' }));
    expect(onFork).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('split: a labelled Fork button and a chevron menu with Pin and Mark as seen', async () => {
    const onFork = vi.fn();
    render(withVariants({ headerActions: 'split' }, <HeaderActions {...ACTIONS} onFork={onFork} />));
    await userEvent.click(screen.getByRole('button', { name: 'Fork' }));
    expect(onFork).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem')).toHaveLength(2);
  });

  it('a blocked Fork is disabled in every look and keeps its reason', async () => {
    render(withVariants({ headerActions: 'menu' }, <HeaderActions {...ACTIONS} forkBlocked="no message yet" />));
    await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
    expect(screen.getByRole('menuitem', { name: /Fork/ })).toBeDisabled();
    expect(screen.getByText('no message yet')).toBeInTheDocument();
  });
});

describe('the Thread action placement', () => {
  const anchor = { kind: 'ok', messageId: 'm1', quote: 'hello' } as unknown as Parameters<typeof ThreadButton>[0]['anchor'];

  it('hover (default): in the DOM and focusable, hidden until the message is hovered or focused, shown without hover', () => {
    render(<ThreadButton anchor={anchor} onThread={vi.fn()} />);
    // The wrapper of the base button carries the reveal.
    const reveal = screen.getByRole('button', { name: 'Thread' }).parentElement!;
    expect(reveal.className).toContain('opacity-0');
    expect(reveal.className).toContain('group-hover:opacity-100');
    expect(reveal.className).toContain('focus-within:opacity-100');
    expect(reveal.className).toContain('[@media(hover:none)]:opacity-100');
  });

  it('always: no reveal classes', () => {
    render(withVariants({ threadPlacement: 'always' }, <ThreadButton anchor={anchor} onThread={vi.fn()} />));
    expect(screen.getByRole('button', { name: 'Thread' }).parentElement!.className).not.toContain('opacity-0');
  });

  it('labelled: shows the word Thread', () => {
    render(withVariants({ threadPlacement: 'labelled' }, <ThreadButton anchor={anchor} onThread={vi.fn()} />));
    expect(screen.getByRole('button', { name: 'Thread' })).toHaveTextContent('Thread');
  });
});

describe('the status chip looks', () => {
  it('soft is the tinted pill, outline a border on the text colour, dot a neutral text with a dot', () => {
    expect(chipSkin('soft', 'bg-a', 'text-a')).toBe('bg-a text-a');
    expect(chipSkin('outline', 'bg-a', 'text-a')).toBe('border border-current bg-transparent text-a');
    expect(chipSkin('dot', 'bg-a', 'text-a')).toBe('bg-transparent text-content');
  });

  it('the dot look draws a dot instead of the icon and keeps the words', () => {
    const session = ownedRow({ ownedState: 'exited' });
    const { container } = render(withVariants({ chipStyle: 'dot' }, <OwnedStateChip session={session} />));
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('span.rounded-full.bg-current')).not.toBeNull();
    expect(screen.getByText('Exited')).toBeInTheDocument();
  });

  it('a list row leaves out the waiting chip of a single request (the row already says it) but keeps a count', () => {
    const one = render(<OwnedStateChip session={ownedRow({ ownedState: 'requires_action', pendingPermissions: 1 })} compact />);
    expect(one.container.textContent).toBe('');
    one.unmount();
    render(<OwnedStateChip session={ownedRow({ ownedState: 'requires_action', pendingPermissions: 3 })} compact />);
    expect(screen.getByText('Waiting for permission (3)')).toBeInTheDocument();
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
  function tree(values: Partial<UiVariantValues>) {
    const service: UrlParamService = { get: () => null, set: () => undefined };
    const sessions = [ownedRow({ sessionId: 'a1', displayName: 'agent-one', cwd: '/w/shop', folder: 'shop' })];
    return render(
      withVariants(
        values,
        <UrlParamContext.Provider value={service}>
          <TreeList sessions={sessions} selectedId={undefined} onSelect={vi.fn()} now={2_000_000} query={parseQuery('')} searching={false} options={DEFAULT_VIEW_OPTIONS} />
        </UrlParamContext.Provider>,
      ),
    );
  }

  it('comfortable: the host badge says its word on the second line', () => {
    tree({ treeDensity: 'comfortable' });
    expect(screen.getByText('Web')).toBeInTheDocument();
  });

  it('compact: the host badge is an icon, its word stays for a screen reader', () => {
    tree({ treeDensity: 'compact' });
    const badge = document.querySelector('[data-host-badge]');
    expect(badge?.querySelector('.sr-only')?.textContent).toBe('Web');
  });

  it('card: the row is a ringed card', () => {
    tree({ treeDensity: 'card' });
    expect(document.querySelector('[data-session-id]')?.className).toContain('ring-1');
  });
});

describe('the details of the detail header', () => {
  function header() {
    stubFetch({});
    return render(<DetailHeader session={row({ sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', displayName: 'one', pid: 12 })} now={2_000_000} busy={false} onBack={vi.fn()} onTogglePin={vi.fn()} onMarkSeen={vi.fn()} onOwnedChange={vi.fn()} onForgotten={vi.fn()} onForked={vi.fn()} onOpenSource={vi.fn()} />);
  }

  it('open by default (a tall window); the toggle hides the chips, keeps the choice and says its state', async () => {
    const { container } = header();
    const chips = (): Element | null => container.querySelector('[data-status-chips]');
    expect(chips()?.className).not.toContain('hidden');
    const toggle = screen.getByRole('button', { name: 'Hide details' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(toggle);
    expect(chips()?.className).toContain('hidden');
    expect(screen.getByRole('button', { name: 'Show details' })).toHaveAttribute('aria-pressed', 'false');
    expect(window.localStorage.getItem('agent-manager.header-details.v1')).toBe('closed');
  });

  it('a saved choice wins on the next load', () => {
    window.localStorage.setItem('agent-manager.header-details.v1', 'closed');
    const { container } = header();
    expect(container.querySelector('[data-status-chips]')?.className).toContain('hidden');
  });
});
