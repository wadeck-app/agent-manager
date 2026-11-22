import { AbExperiments, UrlParamContext, type UrlParamService } from '@wadeck-app/dsl-ui';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('compact (default): the host badge is an icon, its word stays for a screen reader', () => {
    tree({});
    const badge = document.querySelector('[data-host-badge]');
    expect(badge?.querySelector('.sr-only')?.textContent).toBe('Web');
    expect(document.querySelector('[data-herdr-light]')).toBeNull();
  });

  it('the only options are compact and the three Herdr rows', () => {
    expect(Object.keys(UI_QUESTIONS.treeDensity.options)).toEqual(['compact', 'herdr-line', 'herdr-tinted', 'herdr-name']);
  });

  it('herdr-line: bold name, muted folder, age and a light on the right, in a 31 px row', () => {
    tree({ treeDensity: 'herdr-line' });
    const row = document.querySelector('[data-session-id]') as HTMLElement;
    expect(row.className).toContain('h-[31px]');
    expect(within(row).getByText('agent-one').className).toContain('font-semibold');
    expect(within(row).getByText(/shop/, { selector: 'span.text-muted' })).toBeInTheDocument();
    expect(document.querySelector('[data-herdr-light="ring"]')).not.toBeNull();
  });

  it('herdr-name: the name only, no folder text', () => {
    tree({ treeDensity: 'herdr-name' });
    const row = document.querySelector('[data-session-id]') as HTMLElement;
    expect(within(row).getByText('agent-one')).toBeInTheDocument();
    expect(within(row).queryByText(/shop/, { selector: 'span.text-muted' })).toBeNull();
  });

  it('herdr-tinted: a row that needs you is tinted red, a finished unseen one blue, and the open row has the gold outline', () => {
    const sessions = [
      ownedRow({ sessionId: 'n1', displayName: 'needs', folder: 'a', state: 'needs-you', status: 'waiting', reason: 'permission prompt' }),
      ownedRow({ sessionId: 'd1', displayName: 'done', folder: 'b', state: 'done' }),
      ownedRow({ sessionId: 'i1', displayName: 'quiet', folder: 'c', state: 'idle' }),
    ];
    tree({ treeDensity: 'herdr-tinted' }, sessions, 'i1');
    const byId = (id: string): HTMLElement => document.querySelector(`[data-session-id="${id}"]`) as HTMLElement;
    expect(byId('n1').className).toContain('--am-herdr-needs-bg');
    expect(byId('d1').className).toContain('--am-herdr-unseen-bg');
    expect(byId('i1').className).toContain('--am-herdr-active-edge');
    expect(document.querySelector('[data-herdr-light="pill"]')).toHaveTextContent('Needs you');
    expect(document.querySelector('[data-herdr-light="dot"]')).not.toBeNull();
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

  it('bar (default): the folder header is a tinted bar with a left edge, with no custom group needed', () => {
    folders({});
    expect(header().className).toContain('border-l-4');
  });

  it('plain: no bar', () => {
    folders({ groupHeader: 'plain' });
    expect(header().className).not.toContain('border-l-4');
  });

  it('pill puts the folder name in a pill', () => {
    folders({ groupHeader: 'pill' });
    expect(screen.getByText('shop').className).toContain('rounded-full');
  });
});

describe('the details of the detailed header (the Detailed look keeps the toggle)', () => {
  function header() {
    stubFetch({});
    return render(withVariants({ headerActions: 'detailed' }, <DetailHeader session={row({ sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', displayName: 'one', pid: 12 })} now={2_000_000} busy={false} onBack={vi.fn()} onTogglePin={vi.fn()} onMarkSeen={vi.fn()} onOwnedChange={vi.fn()} onForgotten={vi.fn()} onForked={vi.fn()} onOpenSource={vi.fn()} />));
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
