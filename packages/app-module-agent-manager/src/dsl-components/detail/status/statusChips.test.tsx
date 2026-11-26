import { liveTooltip } from './liveTooltip.js';
import { act, fireEvent, render, screen as pageScreen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionStatusDto } from '../deps.js';
import { row } from '../deps.js';
import { DetailHeader } from '../DetailHeader.js';
// violations-suppress: ts/no-deep-relative test helper of the module, not exported through deps.ts (it imports the variants context)
import { DEFAULT_UI_VARIANTS } from '../../logic/uiVariants.js';
// violations-suppress: ts/no-deep-relative test helper of the module, not exported through deps.ts (it imports the variants context)
import { UiVariantsContext } from '../../ui/UiVariants.js';
import { formatSpan, formatTokens } from './format.js';
import { publishLogStatus, resetPublishedStatus } from './useSessionStatus.js';

// The chips of the status live in the one-line header; every query of this file reads that line only.
const screen = new Proxy({} as typeof pageScreen, {
  get: (_target, key) => {
    const line = document.querySelector<HTMLElement>('[data-header-line]');
    if (line === null) {
      throw new Error('The header line is not rendered: call show() first');
    }
    return (within(line) as unknown as Record<string | symbol, unknown>)[key];
  },
});

const session = row({ displayName: 'agent-manager-owner', cwd: '/work/agent-manager', sessionId: '12345678-aaaa-4bbb-8ccc-1234567890ab', pid: 4242, state: 'idle' });

// The shape of a real answer (values of the user's status line: Sonnet 5.5, 37 %, 367.8k up, 816 down, 2h22m, role, one bypass).
const FULL: SessionStatusDto = {
  model: { id: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5', known: true },
  previousModels: [{ id: 'claude-opus-5-5', displayName: 'Opus 5.5', known: true }],
  contextUsedPct: { value: 38, basis: 'estimate', note: 'Sonnet 5.5 was observed above 200k tokens without the [1m] tag: 1000k window assumed', windowTokens: 1_000_000, compactAtTokens: 967_000, usedTokens: 367_800 },
  tokensIn: 367_800,
  tokensOut: 816,
  durationMs: (2 * 60 + 22) * 60_000,
  gitBranch: 'main',
  role: 'autonomous-worker',
  bypasses: [{ category: 'git-commit-push', label: 'c&p', left: '1h52m', leftMs: (60 + 52) * 60_000 }],
};

function show(status?: SessionStatusDto, target = session) {
  if (status !== undefined) {
    publishLogStatus(target.sessionId, status);
  }
  const result = render(
    <UiVariantsContext.Provider value={DEFAULT_UI_VARIANTS}>
      <DetailHeader session={target} now={2_000_000} busy={false} onBack={() => undefined} onTogglePin={() => undefined} onMarkSeen={() => undefined} onOwnedChange={() => undefined} onForgotten={() => undefined} onForked={() => undefined} onOpenSource={() => undefined} />
    </UiVariantsContext.Provider>,
  );
  return result;
}

beforeEach(() => resetPublishedStatus());
afterEach(() => {
  resetPublishedStatus();
  vi.restoreAllMocks();
});

describe('formatting', () => {
  it('writes tokens and spans like the status line', () => {
    expect(formatTokens(367_800)).toBe('367.8k');
    expect(formatTokens(816)).toBe('816');
    expect(formatTokens(1_250_000)).toBe('1.3M');
    expect(formatSpan((2 * 60 + 22) * 60_000)).toBe('2h22m');
    expect(formatSpan(35 * 60_000)).toBe('35m');
    expect(formatSpan(20_000)).toBe('<1m');
  });
});

describe('the status chips of the one-line header', () => {
  it('shows every field of a full status', () => {
    show(FULL);
    const info = document.querySelector('[data-header-line]') as HTMLElement;
    expect(within(info).getByText('/work/agent-manager')).toBeInTheDocument();
    expect(within(info).getByText('main')).toBeInTheDocument();
    expect(within(info).getByLabelText('Model Sonnet 5.5')).toBeInTheDocument();
    // The context is only the share of the auto-compact point: no icon, no bar, no "~"; tokens, point, window and the assumption are in the tooltip.
    const context = within(info).getByRole('img', { name: 'Context 38% of the way to auto-compact, plenty of room' });
    expect(context).toHaveTextContent(/^38%$/);
    expect(context.querySelector('svg')).toBeNull();
    fireEvent.focus(context);
    expect(liveTooltip()).toHaveTextContent(/367\.8k tokens in the context, auto-compact at about 967\.0k \(38%.*Window 1\.0M.*1000k window assumed.*not read from Claude Code/);
    expect(within(info).getByLabelText('Tokens: 367,800 tokens in the prompt of the last call, 816 tokens in its answer (grows while it streams)')).toHaveTextContent('367.8k816');
    expect(within(info).getByLabelText('Running for 2h22m')).toBeInTheDocument();
    expect(within(info).getByLabelText('Role autonomous-worker')).toBeInTheDocument();
    expect(within(info).getByLabelText('Bypass c&p, 1h52m left')).toHaveTextContent('c&p 1h52m');
    expect(within(info).getByLabelText('Session id 12345678-aaaa-4bbb-8ccc-1234567890ab')).toHaveTextContent('12345678');
    expect(within(info).getByText('pid 4242')).toBeInTheDocument();
    // The program is short (CCv2.1.325), its full name is the accessible name and the tooltip.
    expect(within(info).getByLabelText('Claude Code 2.1.325')).toHaveTextContent('CCv2.1.325');
    // No icon on the model, the duration and the session id; the role keeps its icon.
    for (const label of ['Model Sonnet 5.5', 'Running for 2h22m', 'Session id 12345678-aaaa-4bbb-8ccc-1234567890ab']) {
      expect(within(info).getByLabelText(label).querySelector('svg'), label).toBeNull();
    }
    expect(within(info).getByLabelText('Role autonomous-worker').querySelector('svg')).not.toBeNull();
  });

  it('copies path::branch and the session id', () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    show(FULL);
    fireEvent.click(screen.getByRole('button', { name: 'Copy the working directory and branch' }));
    expect(writeText).toHaveBeenCalledWith('/work/agent-manager::main');
    fireEvent.click(screen.getByRole('button', { name: 'Copy the session id' }));
    expect(writeText).toHaveBeenCalledWith('12345678-aaaa-4bbb-8ccc-1234567890ab');
  });

  it('draws nothing for a field that is not available (no empty slot, no branch icon)', () => {
    show({});
    const info = document.querySelector('[data-header-line]') as HTMLElement;
    expect(within(info).queryByLabelText(/^Model/)).toBeNull();
    expect(within(info).queryByRole('img')).toBeNull();
    expect(within(info).queryByLabelText(/^Tokens/)).toBeNull();
    expect(within(info).queryByLabelText(/^Running for/)).toBeNull();
    expect(within(info).queryByLabelText(/^Role/)).toBeNull();
    expect(within(info).queryByLabelText(/^Bypass/)).toBeNull();
    expect(within(info).queryByTitle(/Git branch/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy the working directory' })).toBeInTheDocument();
  });

  it('an unrecognised model id is shown raw with a warning and a tooltip that says so', () => {
    show({ model: { id: 'claude-mystery-9', displayName: 'claude-mystery-9', known: false } });
    const chip = screen.getByLabelText('Model, unrecognised id claude-mystery-9');
    expect(chip).toHaveTextContent('claude-mystery-9');
    fireEvent.focus(chip);
    expect(liveTooltip()).toHaveTextContent('Unrecognised model id: claude-mystery-9');
  });

  it('shows a context at 90 % of the auto-compact point as almost full, in red', () => {
    show({ contextUsedPct: { value: 93, basis: 'estimate', note: 'no 1M signal for this model: the 200k default is assumed', windowTokens: 200_000, compactAtTokens: 167_000, usedTokens: 155_000 } });
    const chip = screen.getByRole('img', { name: 'Context 93% of the way to auto-compact, almost full' });
    expect(chip.querySelector('.text-hue-red')).toHaveTextContent('93%');
  });

  it('shows the earlier models in the tooltip of the model chip', () => {
    show(FULL);
    fireEvent.focus(screen.getByLabelText('Model Sonnet 5.5'));
    expect(liveTooltip()).toHaveTextContent('Before: Opus 5.5');
  });

  it('a broken role file is an error with its cause, never shown as a role', () => {
    show({ role: '!role-err:cannot read the role file' });
    const chip = screen.getByLabelText('Role error: cannot read the role file');
    expect(chip).toHaveTextContent('Role error');
    expect(chip.className).toMatch(/bg-danger-bg/);
    expect(screen.queryByLabelText(/^Role autonomous/)).toBeNull();
  });

  it('shows the reasons as warnings: the status note, a branch error, a bypass file that cannot be read', () => {
    show({ statusNote: 'No assistant message yet: the model and the context are not known.', gitBranchError: 'git is not installed or not on the PATH', bypassError: 'guardrails.bypass.json is not valid JSON' });
    // The status note is a row under the line, not in it.
    expect(pageScreen.getByText('No assistant message yet: the model and the context are not known.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Branch unknown: git is not installed or not on the PATH');
    expect(screen.getByLabelText('Bypass file problem: guardrails.bypass.json is not valid JSON')).toHaveTextContent('Bypass file unreadable');
  });

  it('a bypass counted in uses has no expiry time in its tooltip', () => {
    show({ bypasses: [{ category: 'git-commit-push', label: 'c&p', left: '2x' }] });
    const chip = screen.getByLabelText('Bypass c&p, 2x left');
    fireEvent.focus(chip);
    expect(liveTooltip()).toHaveTextContent('counted in uses (no expiry time)');
  });

  it('uses the fields of the session row until the log has answered, then the live status of the log (one source at a time)', () => {
    const withRow = row({ ...session, model: { id: 'claude-opus-5-5', displayName: 'Opus 5.5', known: true }, gitBranch: 'row-branch' });
    show(undefined, withRow);
    expect(screen.getByLabelText('Model Opus 5.5')).toBeInTheDocument();
    expect(screen.getByText('row-branch')).toBeInTheDocument();
    act(() => publishLogStatus(withRow.sessionId, { model: { id: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5', known: true } }));
    expect(screen.getByLabelText('Model Sonnet 5.5')).toBeInTheDocument();
    expect(screen.queryByLabelText('Model Opus 5.5')).toBeNull();
    // No field of the row is mixed in: the live status has no branch, so none is shown.
    expect(screen.queryByText('row-branch')).toBeNull();
    // Leaving the log (unmount) gives the row back.
    act(() => publishLogStatus(withRow.sessionId, undefined));
    expect(screen.getByLabelText('Model Opus 5.5')).toBeInTheDocument();
  });
});
