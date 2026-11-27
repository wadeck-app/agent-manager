import { hoverTip, liveTooltip } from '../detail/status/liveTooltip.js';
import { AbExperiments, UrlParamContext, type UrlParamService } from '@wadeck-app/dsl-ui';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HeaderActions, type HeaderActionsProps } from '../detail/HeaderActions.js';
import { DetailHeader } from '../detail/DetailHeader.js';
import { THREAD_TOOLTIP, ThreadButton } from '../detail/log/ThreadButton.js';
import { parseQuery } from '../logic/fuzzy.js';
import { ownedRow, row } from '../logic/fixtures.js';
import { DEFAULT_UI_VARIANTS, UI_QUESTIONS, type UiVariantValues } from '../logic/uiVariants.js';
import { DEFAULT_VIEW_OPTIONS, type ViewOptions } from '../logic/viewOptions.js';
import { TreeList } from '../lists/TreeList.js';
import { OwnedStateChip } from '../owned/OwnedStateChip.js';
import { stubFetch } from '../owned/testFetch.js';
import { Toolbar } from '../workspace/Toolbar.js';
import { Scope } from './Scope.js';
import { TrailSlot } from './TrailSlot.js';
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

describe('the header actions (settled look: one line of icons)', () => {
  it('Fork, Pin and Mark as seen are three icon buttons, the one that is off says why', () => {
    render(<HeaderActions {...ACTIONS} />);
    expect(screen.getByRole('button', { name: 'Fork' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Pin' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Mark as seen' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /more actions|details/i })).toBeNull();
  });

  it('a pinned session offers Unpin, a Done one can be marked as seen, and each button runs its action', async () => {
    const onTogglePin = vi.fn();
    const onMarkSeen = vi.fn();
    const onFork = vi.fn();
    render(<HeaderActions {...ACTIONS} pinned canMarkSeen onTogglePin={onTogglePin} onMarkSeen={onMarkSeen} onFork={onFork} />);
    await userEvent.click(screen.getByRole('button', { name: 'Unpin' }));
    await userEvent.click(screen.getByRole('button', { name: 'Mark as seen' }));
    await userEvent.click(screen.getByRole('button', { name: 'Fork' }));
    expect([onTogglePin, onMarkSeen, onFork].map((fn) => fn.mock.calls.length)).toEqual([1, 1, 1]);
  });

  it('a blocked Fork is off and a busy header turns every action off', () => {
    const { rerender } = render(<HeaderActions {...ACTIONS} forkBlocked="no message yet" />);
    expect(screen.getByRole('button', { name: 'Fork' })).toBeDisabled();
    rerender(<HeaderActions {...ACTIONS} busy canMarkSeen />);
    for (const name of ['Fork', 'Pin', 'Mark as seen']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });
});

describe('the Thread action of a message', () => {
  const anchor = { kind: 'ok', messageId: 'm1', quote: 'hello' } as unknown as Parameters<typeof ThreadButton>[0]['anchor'];

  it('is always visible: no reveal on hover, at the right end of the row, with the tooltip that says what it does', () => {
    render(<ThreadButton anchor={anchor} onThread={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Thread' });
    const slot = button.closest('[data-thread-action]') as HTMLElement;
    expect(slot.className).not.toContain('opacity-0');
    expect(slot.className).toContain('ml-auto');
    hoverTip(button);
    expect(liveTooltip().textContent).toBe(THREAD_TOOLTIP);
    expect(button).not.toHaveAttribute('title', expect.stringMatching(/./));
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
    // The header is drawn through the shell slot (the breadcrumb row), which the test provides.
    const inTrail = (extra: { detailOpen?: boolean }) => (
      <TrailSlot>
        <Toolbar {...props} {...extra} />
      </TrailSlot>
    );
    const { rerender } = render(inTrail({}));
    expect(document.querySelector('[data-toolbar]')?.className).not.toContain('hidden');
    rerender(inTrail({ detailOpen: true }));
    expect(document.querySelector('[data-toolbar]')?.className).toContain('hidden lg:flex');
  });
});

// The flat tree: the row writes its folder (under a folder header it does not, Q37).
const FLAT_TREE: ViewOptions = { ...DEFAULT_VIEW_OPTIONS, tree: { ...DEFAULT_VIEW_OPTIONS.tree, grouping: 'none' as const } };

describe('the Tree rows (settled Herdr look)', () => {
  function tree(values: Partial<UiVariantValues>, sessions = [ownedRow({ sessionId: 'a1', displayName: 'agent-one', cwd: '/w/shop', folder: 'shop' })], selectedId?: string, options: ViewOptions = FLAT_TREE) {
    const service: UrlParamService = { get: () => null, set: () => undefined };
    return render(
      withVariants(
        values,
        <UrlParamContext.Provider value={service}>
          <TreeList sessions={sessions} selectedId={selectedId} onSelect={vi.fn()} now={2_000_000} query={parseQuery('')} searching={false} options={options} />
        </UrlParamContext.Provider>,
      ),
    );
  }

  it('herdr (default): 30 px row, 13 px grey name for a quiet agent, muted folder, 11 px age and a light in the fixed 28 px column on the right', () => {
    tree({});
    const row = document.querySelector('[data-session-id]') as HTMLElement;
    expect(row.className).toContain('h-[30px]');
    // The default look: the same name color for every agent (the dimIdle setting brings the grey of a quiet agent back).
    expect(within(row).getByText('agent-one').className).toContain('text-content');
    expect(within(row).getByText(/shop/, { selector: 'span.text-muted-tint' })).toBeInTheDocument();
    expect(row.querySelector('[data-herdr-age]')?.className).toContain('text-[11px]');
    expect(document.querySelector('[data-herdr-light="ring"]')).not.toBeNull();
    const column = row.querySelector('[data-status-column]') as HTMLElement;
    expect(column.className).toContain('w-7');
    expect(column.className).toContain('justify-center');
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
    // The default look: the open name is not bold (the boldActive setting brings the semibold back).
    expect(within(byId('i1')).getByText('quiet').className).toContain('font-normal');
    expect(within(byId('i1')).getByText('quiet').className).toContain('text-content');
    // No pill with words in a row (the names keep the room); the light column holds the compact "!" box, named for assistive technology.
    expect(document.querySelector('[data-needs-you-pill]')).toBeNull();
    expect(document.querySelector('[data-herdr-light="pill"]')).toHaveTextContent('!');
    expect(document.querySelector('[data-herdr-light="dot"]')).not.toBeNull();
  });

  it('every state light and every folder header icon sit in the same 28 px column, centred, with the same right edge (one vertical axis)', () => {
    const sessions = [
      ownedRow({ sessionId: 'w1', displayName: 'working', folder: 'a', state: 'working' }),
      ownedRow({ sessionId: 'd1', displayName: 'done', folder: 'a', state: 'done' }),
      ownedRow({ sessionId: 'i1', displayName: 'quiet', folder: 'a', state: 'idle' }),
    ];
    const { container } = tree({}, sessions, undefined, DEFAULT_VIEW_OPTIONS);
    const columns = Array.from(container.querySelectorAll<HTMLElement>('[data-status-column="icon"]'));
    // Three rows and one folder header.
    expect(columns).toHaveLength(4);
    for (const column of columns) {
      expect(column.className).toContain('w-7');
      expect(column.className).toContain('justify-center');
      expect(column.className).toContain('shrink-0');
    }
    const folder = (screen.getAllByText('a')[0] as HTMLElement).closest('[aria-level="1"]') as HTMLElement;
    expect(folder.querySelector('[data-status-column]')).not.toBeNull();
    // The rows end 10 px from the list edge (mx-2 and pr-0.5), the header too (pr-2.5): same axis.
    const rowEdge = (document.querySelector('[data-session-id]') as HTMLElement).className;
    expect(rowEdge).toContain('mx-2');
    expect(rowEdge).toContain('pr-0.5');
    expect(folder.className).toContain('pr-2.5');
  });
});

describe('the group header on the folder headers (settled Herdr look)', () => {
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
  const header = (): HTMLElement => (screen.getAllByText('shop')[0] as HTMLElement).closest('[aria-level="1"]') as HTMLElement;

  it('a plain 11 px header, no bar, no pill, the count after the name', () => {
    folders({});
    expect(header().className).not.toContain('border-l-4');
    expect((screen.getAllByText('shop')[0] as HTMLElement).className).toContain('text-[11px]');
    expect((screen.getAllByText('shop')[0] as HTMLElement).className).not.toContain('rounded-full');
    expect(header().querySelector('[data-status-column]')).not.toBeNull();
  });
});

describe('the header shell', () => {
  it('is one line with no horizontal scroll and no three rows', () => {
    stubFetch({});
    const { container } = render(<DetailHeader session={row({ sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', displayName: 'one', pid: 12 })} now={2_000_000} busy={false} onBack={vi.fn()} onTogglePin={vi.fn()} onMarkSeen={vi.fn()} onOwnedChange={vi.fn()} onForgotten={vi.fn()} onForked={vi.fn()} onOpenSource={vi.fn()} />);
    const shell = container.querySelector('header') as HTMLElement;
    expect(shell.getAttribute('data-header-layout')).toBe('line');
    expect(shell.className).toContain('overflow-x-hidden');
    expect(shell.className).not.toMatch(/overflow-x-(auto|scroll)/);
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
