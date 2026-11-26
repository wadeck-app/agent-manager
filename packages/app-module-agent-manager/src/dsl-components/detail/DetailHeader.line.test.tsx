import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_UI_VARIANTS, type UiVariantValues } from '../logic/uiVariants.js';
import { ownedDto, ownedRow, row } from '../logic/fixtures.js';
import { DaemonStateProvider } from '../owned/DaemonState.js';
import { stubFetch } from '../owned/testFetch.js';
import { UiVariantsContext } from '../ui/UiVariants.js';
import type { SessionStatusDto } from './deps.js';
import { DetailHeader } from './DetailHeader.js';
import { publishLogStatus, resetPublishedStatus } from './status/useSessionStatus.js';
import { focusByKeyboard, hoverTip, liveTooltip } from './status/liveTooltip.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetPublishedStatus();
});
beforeEach(() => {
  window.localStorage.clear();
  resetPublishedStatus();
});

const ID = '11111111-1111-4111-8111-111111111111';

function header(session: ReturnType<typeof row>, values: Partial<UiVariantValues> = {}, down = false) {
  stubFetch({ 'GET /owned': { body: { ok: true, generatedAt: 'now', daemon: {}, sessions: [ownedDto({ id: ID })] } } });
  return render(
    <UiVariantsContext.Provider value={{ ...DEFAULT_UI_VARIANTS, ...values }}>
      <DaemonStateProvider down={down}>
        <DetailHeader session={session} now={2_000_000} busy={false} onBack={vi.fn()} onTogglePin={vi.fn()} onMarkSeen={vi.fn()} onOwnedChange={vi.fn()} onForgotten={vi.fn()} onForked={vi.fn()} onOpenSource={vi.fn()} />
      </DaemonStateProvider>
    </UiVariantsContext.Provider>,
  );
}

describe('the one-line header (the default)', () => {
  it('puts the name, the state, the age, the folder, the program and the actions on ONE line (no second row for a discovered session)', () => {
    const { container } = header(row({ displayName: 'one', cwd: '/w/shop', pid: 12, state: 'working', status: 'busy', statusUpdatedAt: 1_000_000 }));
    const top = container.querySelector('header > div') as HTMLElement;
    const line = top.querySelector('[data-header-line]') as HTMLElement;
    expect(within(line).getByRole('heading', { name: 'one' })).toBeInTheDocument();
    expect(within(line).getByText('Working')).toBeInTheDocument();
    expect(line.querySelector('[data-line-item="folder"]')).toHaveTextContent('/w/shop');
    expect(line.querySelector('[data-line-item="harness"]')).toHaveTextContent('CCv2.1.325');
    // The actions are in the same top row, to the right of the line.
    expect(within(top).getByRole('button', { name: 'Fork' })).toBeInTheDocument();
    expect(within(top).getByRole('button', { name: 'Pin' })).toBeInTheDocument();
    // Only the one row exists: nothing else is drawn under it for a quiet session.
    expect(container.querySelector('header')?.children).toHaveLength(1);
  });

  it('every session says what runs in it (Move readiness) in the line, with the reason it cannot move in its tooltip text', () => {
    const { container } = header(row({ adoptReadiness: { state: 'busy', reasons: ['A turn is running', 'Tool Bash is running'] } }));
    expect(container.querySelector('[data-line-item="move"]')).toHaveTextContent('Busy: 2 running');
  });

  it('an owned Web session draws its controls as icons at the right of the line (Stop, Move) and the mode in a thin row', async () => {
    const { container } = header(ownedRow({ sessionId: ID, displayName: 'web', state: 'idle', adoptReadiness: { state: 'free', reasons: [] } }));
    const top = container.querySelector('header > div') as HTMLElement;
    expect(await within(top).findByRole('button', { name: /Stop/ })).toBeInTheDocument();
    const move = within(top).getByRole('button', { name: 'Move to Terminal' });
    expect(move.closest('[data-adopt-button]')).toHaveAttribute('data-readiness', 'free');
    expect(await screen.findByLabelText('Permission mode')).toBeInTheDocument();
  });

  const BUSY = { state: 'busy' as const, reasons: ['A turn is running'] };
  const MOVE_NAME = 'Move to Terminal (interrupts 1 running item)';

  it('readiness look A (default): the Move icon is tinted by the state with a 10 px dot and says what runs in its name, the amber badge is in the line', async () => {
    const { container } = header(ownedRow({ sessionId: ID, adoptReadiness: BUSY }));
    const move = await within(container as HTMLElement).findByRole('button', { name: MOVE_NAME });
    expect(move.closest('[data-adopt-button]')).toHaveAttribute('data-tone', 'neutral');
    expect(move.textContent).toBe('');
    expect(container.querySelector('[data-readiness-dot="busy"]')?.className).toContain('bg-warning');
    // The dot is 10 px with a ring that cuts it from the header, and the whole icon sits in an amber tint (not the words of look B, not the plain grey of look C).
    expect(container.querySelector('[data-readiness-dot="busy"]')?.className).toContain('h-2.5');
    expect(container.querySelector('[data-readiness-tint="busy"]')?.className).toContain('bg-warning-bg');
    expect(container.querySelector('[data-line-item="move"] [data-adopt-badge="busy"]')).toHaveTextContent('Busy: 1 running');
    expect(container.querySelector('[data-adopt-banner]')).toBeNull();
  });

  it('readiness look B: a coloured pill with words (amber busy, green free), no badge in the line', async () => {
    const busy = header(ownedRow({ sessionId: ID, adoptReadiness: BUSY }), { switchReadiness: 'button' });
    const move = await within(busy.container as HTMLElement).findByRole('button', { name: MOVE_NAME });
    expect(move).toHaveTextContent('Move: 1 running');
    expect(move.className).toContain('bg-warning-bg');
    expect(move.closest('[data-adopt-button]')).toHaveAttribute('data-tone', 'warning');
    expect(busy.container.querySelector('[data-line-item="move"]')).toBeNull();
    busy.unmount();
    const free = header(ownedRow({ sessionId: ID, adoptReadiness: { state: 'free', reasons: [] } }), { switchReadiness: 'button' });
    const freeMove = await within(free.container as HTMLElement).findByRole('button', { name: 'Move to Terminal' });
    expect(freeMove).toHaveTextContent('Move: free');
    expect(freeMove.className).toContain('bg-hue-green-bg');
  });

  it('readiness look C: a plain grey icon, no badge, and a full-width row under the line that says what moving does (amber busy, green free)', async () => {
    const busy = header(ownedRow({ sessionId: ID, adoptReadiness: BUSY }), { switchReadiness: 'banner' });
    const move = await within(busy.container as HTMLElement).findByRole('button', { name: MOVE_NAME });
    expect(move.textContent).toBe('');
    expect(busy.container.querySelector('[data-line-item="move"]')).toBeNull();
    expect(busy.container.querySelector('[data-adopt-banner="busy"]')).toHaveTextContent('Moving interrupts 1 running item: A turn is running');
    busy.unmount();
    const free = header(ownedRow({ sessionId: ID, adoptReadiness: { state: 'free', reasons: [] } }), { switchReadiness: 'banner' });
    await within(free.container as HTMLElement).findByRole('button', { name: 'Move to Terminal' });
    expect(free.container.querySelector('[data-adopt-banner="free"]')).toHaveTextContent('Nothing runs: moving keeps the whole conversation.');
  });

  it('with the daemon down the owned icons are off and the line says why Move is unavailable', async () => {
    const { container } = header(ownedRow({ sessionId: ID, adoptReadiness: { state: 'free', reasons: [] } }), {}, true);
    const stop = await within(container as HTMLElement).findByRole('button', { name: /Stop/ });
    expect(stop).toBeDisabled();
    expect(container.querySelector('[data-line-item="move"]')).toHaveTextContent('Free to move');
    expect(container.querySelector('[data-line-item="move"] [data-adopt-badge]')).toHaveAttribute('data-adopt-badge', 'free');
  });
});

const FULL: SessionStatusDto = {
  model: { id: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5', known: true },
  contextUsedPct: { value: 38, basis: 'estimate', note: 'estimate', windowTokens: 1_000_000, compactAtTokens: 967_000, usedTokens: 367_800 },
  tokensIn: 367_800,
  tokensOut: 816,
  durationMs: (2 * 60 + 22) * 60_000,
  gitBranch: 'main',
  role: 'autonomous-worker',
  bypasses: [{ category: 'git-commit-push', label: 'c&p', left: '1h52m', leftMs: (60 + 52) * 60_000 }],
};

describe('the one-line header: everything the three rows said', () => {
  it('has the folder with its branch, model, context, role, bypass, tokens, duration, program, session id and pid on the same line', () => {
    const session = row({ displayName: 'agent-manager-owner', cwd: '/work/agent-manager', sessionId: '12345678-aaaa-4bbb-8ccc-1234567890ab', pid: 4242 });
    publishLogStatus(session.sessionId, FULL);
    const { container } = header(session);
    const line = container.querySelector('[data-header-line]') as HTMLElement;
    expect(within(line).getByText('main')).toBeInTheDocument();
    expect(within(line).getByLabelText('Model Sonnet 5.5')).toBeInTheDocument();
    expect(within(line).getByRole('img', { name: /^Context 38%/ })).toHaveTextContent(/^38%$/);
    expect(within(line).getByLabelText('Role autonomous-worker')).toBeInTheDocument();
    expect(within(line).getByLabelText('Bypass c&p, 1h52m left')).toBeInTheDocument();
    expect(within(line).getByLabelText(/^Tokens/)).toBeInTheDocument();
    expect(within(line).getByLabelText('Running for 2h22m')).toBeInTheDocument();
    expect(within(line).getByLabelText('Claude Code 2.1.325')).toHaveTextContent('CCv2.1.325');
    expect(within(line).getByLabelText(/^Session id 12345678/)).toBeInTheDocument();
    expect(within(line).getByText('pid 4242')).toBeInTheDocument();
    expect(line.querySelector('[data-line-more]')).toBeNull();
  });

  it('shortens a long folder path in the middle and keeps the whole path in the tooltip', () => {
    // violations-suppress: shared/no-out-of-repo-path a Windows path is the data of the shortening, it is never opened
    const cwd = 'C:\Workspace_Tooling\agent-manager\packages\app-module-agent-manager\src';
    const { container } = header(row({ cwd }));
    const folder = container.querySelector('[data-line-item="folder"] .truncate') as HTMLElement;
    expect(folder.textContent).toContain('...');
    expect(folder.textContent?.endsWith('src')).toBe(true);
    hoverTip(folder);
    expect(liveTooltip()).toHaveTextContent(cwd);
  });

  // jsdom has no layout: fake it. The line is `lineWidth` wide, the name, state and age are 50 px each, every chip `chip` px unless listed in `wide`.
  function fakeLayout(lineWidth: number, chip: number, wide: Record<string, number> = {}): void {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-header-line') ? lineWidth : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const key = this.getAttribute('data-line-item');
      const width = key === null ? (this.hasAttribute('data-line-more') ? 36 : 50) : (wide[key] ?? chip);
      return { width, height: 20, top: 0, left: 0, right: width, bottom: 20, x: 0, y: 0, toJSON: () => ({}) };
    });
  }

  it('keeps the context percentage next to the name when the wide folder cannot fit (the old fit dropped every chip behind the folder)', () => {
    // 90 px free for the chips: the folder (200) cannot fit; the context (10) can, next to the +N chip.
    fakeLayout(240, 10, { folder: 200 });
    const session = row({ cwd: '/work/agent-manager', pid: 4242 });
    publishLogStatus(session.sessionId, FULL);
    const { container } = header(session);
    const line = container.querySelector('[data-header-line]') as HTMLElement;
    expect(line.querySelector('[data-line-item="folder"]')).toBeNull();
    expect(within(line).getByRole('img', { name: /^Context 38%/ })).toBeInTheDocument();
    const more = line.querySelector('[data-line-more]') as HTMLElement;
    expect(more.getAttribute('aria-label')).toContain('folder /work/agent-manager');
  });

  it('every entry of the +N tooltip carries a value: never "context used" alone', () => {
    fakeLayout(150, 10);
    const session = row({ pid: 4242, cwd: '/work/agent-manager' });
    publishLogStatus(session.sessionId, FULL);
    const { container } = header(session);
    const more = container.querySelector('[data-line-more]') as HTMLElement;
    focusByKeyboard(more);
    const tip = liveTooltip()?.textContent ?? '';
    expect(tip).toContain('context 38% of the way to auto-compact');
    expect(tip).not.toMatch(/context used/);
    const entries = tip.replace(/^Not enough room for: /, '').replace(/\.$/, '').split('; ');
    expect(entries.length).toBeGreaterThan(1);
    // Each entry is "label value": at least two words.
    for (const entry of entries) {
      expect(entry.trim().split(/\s+/).length, entry).toBeGreaterThanOrEqual(2);
    }
  });

  it('puts what does not fit into a +N chip, lowest priority first, and lists it with its value in the tooltip', () => {
    // Chips of 10 px except the pid (400 px): only the pid cannot fit.
    fakeLayout(400, 10, { pid: 400 });
    const session = row({ pid: 4242 });
    publishLogStatus(session.sessionId, FULL);
    const { container } = header(session);
    const more = container.querySelector('[data-line-more]') as HTMLElement;
    expect(more).toHaveTextContent('+1');
    expect(more.getAttribute('aria-label')).toMatch(/^1 more: pid 4242/);
    focusByKeyboard(more);
    expect(liveTooltip()).toHaveTextContent('Not enough room for: pid 4242.');
    expect(screen.queryByText('pid 4242')).toBeNull();
    expect(within(container as HTMLElement).getByLabelText('Model Sonnet 5.5')).toBeInTheDocument();
  });

  it('keeps the warnings visible: a branch error on the line, the status note under it', () => {
    const session = row();
    publishLogStatus(session.sessionId, { statusNote: 'No assistant message yet: the model and the context are not known.', gitBranchError: 'git is not installed or not on the PATH' });
    header(session);
    expect(screen.getByRole('alert')).toHaveTextContent('Branch unknown: git is not installed or not on the PATH');
    expect(screen.getByText('No assistant message yet: the model and the context are not known.')).toBeInTheDocument();
  });

  it('a session that needs you gets its reason on a compact line under, and a fork says where it comes from', () => {
    const { container } = header(row({ state: 'needs-you', status: 'waiting', reason: 'permission prompt' }));
    expect(container.querySelector('header')?.children).toHaveLength(2);
    expect(screen.getByText('permission prompt')).toBeInTheDocument();
  });
});
