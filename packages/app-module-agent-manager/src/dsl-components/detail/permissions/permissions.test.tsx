import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
// violations-suppress: ts/no-deep-relative test fixtures of the logic folder
import { overview } from '../../logic/permissionsFixtures.js';
import { GUARDRAILS_WRITE_NEEDS, permissionsOf, row } from '../deps.js';
import type { GrantDto } from '../deps.js';
import { SubagentAside, type RailTab } from '../log/SubagentAside.js';
import { PermissionsPanel } from './PermissionsPanel.js';
import type { SessionGrantsFeed } from './useSessionGrants.js';

const SID = '00000000-0000-4000-8000-000000000001';
const session = row({ sessionId: SID, cwd: '/w/shop', guardrailBlocks: { total: 5, categories: [{ category: 'rm', count: 3 }, { category: 'interpreter-exec', count: 2 }], timeout: false } });
const future = Date.now() + 600_000;
const grant = (id: string, sessionId: string, overrides: Partial<GrantDto> = {}): GrantDto => ({ id, category: 'rm', mode: 'ttl', expiresAt: future, remainingMs: 600_000, sessionId, sessionName: '', project: '/w/shop', rationale: 'clean the build folder', used: 1, maxUses: null, ...overrides });

function feedOf(grants: GrantDto[] | undefined, extra: Partial<SessionGrantsFeed> = {}): SessionGrantsFeed {
  const data = grants === undefined ? undefined : overview(grants);
  return { overview: data, view: data === undefined ? undefined : permissionsOf(data, SID, session.cwd), error: '', loading: false, reload: vi.fn(), ...extra };
}

describe('the Permissions panel', () => {
  it('lists the bypasses of this session and of the other sessions of its project, with category, mode, time left, uses and reason', () => {
    render(<PermissionsPanel session={session} feed={feedOf([grant('g1', SID), grant('g2', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', { sessionName: 'billing-owner', category: 'interpreter-exec', mode: 'once', maxUses: 1, used: 0, rationale: 'run the migration' })])} />);
    const mine = screen.getByRole('region', { name: 'This session' });
    expect(within(mine).getByText('rm')).toBeInTheDocument();
    expect(within(mine).getByText('time-boxed')).toBeInTheDocument();
    expect(within(mine).getByText((_, element) => element?.tagName === 'P' && element.textContent === '10 min left, 1 use, no limit')).toBeInTheDocument();
    expect(within(mine).getByText('clean the build folder')).toBeInTheDocument();
    const project = screen.getByRole('region', { name: 'Other sessions of this project' });
    expect(within(project).getByText('Session billing-owner')).toBeInTheDocument();
    expect(within(project).getByText(/0 of 1 uses/)).toBeInTheDocument();
  });

  it('says so when there is no bypass: an explicit sentence per section, never an empty panel', () => {
    render(<PermissionsPanel session={session} feed={feedOf([])} />);
    expect(screen.getByText('No active bypass for this session.')).toBeInTheDocument();
    expect(screen.getByText('No active bypass for the other sessions of this project.')).toBeInTheDocument();
  });

  it('says when the folder of the session is unknown, so its project cannot be matched', () => {
    render(<PermissionsPanel session={row({ sessionId: SID, cwd: '' })} feed={feedOf([])} />);
    expect(screen.getByText('The folder of this session is unknown, so its project cannot be matched.')).toBeInTheDocument();
  });

  it('Add bypass and Revoke are drawn disabled with the reason as the tooltip; nothing is sent', () => {
    render(<PermissionsPanel session={session} feed={feedOf([grant('g1', SID)])} />);
    const add = screen.getByRole('button', { name: 'Add bypass' });
    const revoke = screen.getByRole('button', { name: 'Revoke the rm bypass' });
    for (const button of [add, revoke]) {
      expect(button).toBeDisabled();
      expect(button.closest('[data-write-control]')).toHaveAttribute('title', GUARDRAILS_WRITE_NEEDS);
    }
    expect(GUARDRAILS_WRITE_NEEDS).toBe('Needs the w-guardrails API (list/revoke/grant): not available yet');
  });

  it('shows the blocked counters by category with a copy button per category, and a link to the Guardrails page', () => {
    render(<PermissionsPanel session={session} feed={feedOf([])} />);
    const blocked = screen.getByRole('region', { name: 'Blocked' });
    expect(within(blocked).getByText('interpreter-exec')).toBeInTheDocument();
    expect(within(blocked).getByRole('button', { name: /Copy \/w-guardrails:request-bypass rm once/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Guardrails page' })).toHaveAttribute('href', '/modules/agent-manager/guardrails');
  });

  it('a session with no counters says it was not blocked', () => {
    render(<PermissionsPanel session={row({ sessionId: SID, cwd: '/w/shop' })} feed={feedOf([])} />);
    expect(screen.getByText(/No guardrail blocked this session/)).toBeInTheDocument();
  });

  it('a failed read is an alert with the reason; the last list stays on screen when there is one', () => {
    const { rerender } = render(<PermissionsPanel session={session} feed={feedOf(undefined, { error: 'Cannot reach the app-core server.' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('The bypasses could not be read: Cannot reach the app-core server.');
    rerender(<PermissionsPanel session={session} feed={feedOf([grant('g1', SID)], { error: 'Cannot reach the app-core server.' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('the list is the last one read');
    expect(screen.getByText('clean the build folder')).toBeInTheDocument();
  });

  it('says it is reading before the first answer, and warns about unreadable files and the emergency switch', () => {
    const { rerender } = render(<PermissionsPanel session={session} feed={feedOf(undefined, { loading: true })} />);
    expect(screen.getByText('Reading the guardrails files...')).toBeInTheDocument();
    const data = overview([]);
    data.problems = [{ file: 'x', message: 'bad', hint: 'fix' }];
    data.killSwitch = { active: true, path: 'p', errorText: '' };
    rerender(<PermissionsPanel session={session} feed={{ overview: data, view: permissionsOf(data, SID, session.cwd), error: '', loading: false, reload: vi.fn() }} />);
    expect(screen.getByText(/1 guardrails file could not be read/)).toBeInTheDocument();
    expect(screen.getByText(/emergency switch is on/)).toBeInTheDocument();
  });
});

describe('the rail with its two tabs', () => {
  const base = { items: [], mode: 'summary' as const, onMode: vi.fn(), order: 'recent' as const, onOrder: vi.fn(), selectedId: undefined, phase: 'idle' as const, onSelect: vi.fn(), note: '', problem: '', onDismissProblem: vi.fn() };

  function RailHost({ initial, collapsed, grants }: { initial: RailTab; collapsed: boolean; grants: SessionGrantsFeed }) {
    const [tab, setTab] = useState(initial);
    const [shut, setShut] = useState(collapsed);
    return <SubagentAside {...base} session={session} grants={grants} tab={tab} onTab={setTab} collapsed={shut} onCollapsed={setShut} />;
  }

  it('collapsed: the shield button carries the number of active bypasses, and opens the panel on the Permissions tab', () => {
    render(<RailHost initial="subagents" collapsed grants={feedOf([grant('g1', SID), grant('g2', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', { rationale: 'other reason' })])} />);
    const button = screen.getByRole('button', { name: 'Permissions: 2 active bypasses' });
    expect(button.querySelector('[data-permissions-badge]')).toHaveTextContent('2');
    fireEvent.click(button);
    const panel = screen.getByRole('complementary', { name: 'Permissions' });
    expect(within(panel).getByRole('heading', { name: 'Permissions' })).toBeInTheDocument();
    expect(within(panel).getByText('clean the build folder')).toBeInTheDocument();
  });

  it('no badge for zero bypasses (the label says it), and no sub-agents is said on the Sub-agents tab', () => {
    render(<RailHost initial="permissions" collapsed={false} grants={feedOf([])} />);
    expect(screen.getByRole('button', { name: 'Permissions: 0 active bypasses' }).querySelector('[data-permissions-badge]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Sub-agents tab/ }));
    expect(screen.getByText('This session has no sub-agents.')).toBeInTheDocument();
  });
});
