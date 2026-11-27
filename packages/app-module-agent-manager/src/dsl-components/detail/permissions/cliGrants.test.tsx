import { descriptionOf, focusByKeyboard, hoverTip, liveTooltip } from '../status/liveTooltip.js';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
// violations-suppress: ts/no-deep-relative test fixtures of the logic folder
import { overview } from '../../logic/permissionsFixtures.js';
// violations-suppress: ts/no-deep-relative test fixtures of the owned folder
import { stubFetch } from '../../owned/testFetch.js';
import { permissionsOf, row } from '../deps.js';
import type { CliGrantDto, SessionGrantsDto } from '../deps.js';
import { PermissionsPanel } from './PermissionsPanel.js';
import type { CliGrantsState, SessionGrantsFeed } from './useSessionGrants.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const SID = '00000000-0000-4000-8000-000000000001';
const session = row({ sessionId: SID, cwd: '/w/shop' });
const cliGrant = (id: string, over: Partial<CliGrantDto> = {}): CliGrantDto => ({ id, category: 'rm', mode: 'once', sessionId: SID, expiresAt: Date.now() + 600_000, remainingMs: 600_000, remainingText: '10 min', usesLeft: 1, reason: 'clean the build folder', origin: null, ...over });
const data = (grants: CliGrantDto[], over: Partial<SessionGrantsDto> = {}): SessionGrantsDto => ({ ok: true, code: '', sessionId: SID, cwd: '/w/shop', cwdNote: '', grants, errorText: '', ...over });

function feed(cli: CliGrantsState, extra: Partial<SessionGrantsFeed> = {}): SessionGrantsFeed {
  const files = overview([]);
  return { overview: files, view: permissionsOf(files, SID, session.cwd), error: '', loading: false, reload: vi.fn(), cli, ...extra };
}

const CSRF = { 'GET /csrf': { body: { header: 'x-agent-manager-csrf', token: 't' } } };
const REVOKE = 'POST /guardrails/grants/a1b2c3d4/revoke';

describe('the bypasses of the session from the admin CLI', () => {
  it('lists category, time left, the use limit (only when there is one) and the reason; the full id is in the tooltip, no "read from files" label', () => {
    render(<PermissionsPanel session={session} feed={feed({ kind: 'ok', data: data([cliGrant('a1b2c3d4'), cliGrant('b2c3d4e5', { category: 'interpreter-exec', mode: 'ttl', usesLeft: null, reason: '' })]) })} />);
    const mine = screen.getByRole('region', { name: 'This session' });
    const first = mine.querySelector('[data-cli-grant="a1b2c3d4"]') as HTMLElement;
    expect(within(first).getByText('rm')).toBeInTheDocument();
    expect(first.querySelector('[data-grant-uses]')).toHaveTextContent('1 use left');
    expect(first.querySelector('[data-grant-left]')).toHaveTextContent('10 min left');
    expect(first.querySelector('[data-grant-reason]')).toHaveTextContent('clean the build folder');
    // No key link on the row any more: the ids are in the tooltip of the reason.
    expect(first.querySelector('[data-full-session]')).toBeNull();
    hoverTip(first.querySelector('[data-grant-reason]') as HTMLElement);
    expect(liveTooltip()).toHaveTextContent(`Session id${SID}`);
    expect(liveTooltip()).toHaveTextContent('Bypass ida1b2c3d4');
    const second = mine.querySelector('[data-cli-grant="b2c3d4e5"]') as HTMLElement;
    expect(second.querySelector('[data-grant-uses]')).toBeNull();
    expect(second).not.toHaveTextContent('no use limit');
    expect(second.querySelector('[data-grant-reason]')).toHaveTextContent('No reason given');
    expect(screen.queryByText('read from files (admin CLI not found)')).toBeNull();
  });

  it('counts down every second without a new request, and a grant that ran out cannot be revoked', () => {
    vi.useFakeTimers();
    render(<PermissionsPanel session={session} feed={feed({ kind: 'ok', data: data([cliGrant('a1b2c3d4', { expiresAt: Date.now() + 65_000 })]) })} />);
    const text = (): string => document.querySelector('[data-grant-left]')?.textContent ?? '';
    expect(text()).toContain('1 min left');
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(text()).toContain('55 s left');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(text()).toContain('expired');
    expect(screen.getByRole('button', { name: 'Revoke the rm bypass' })).toBeDisabled();
  });

  it('says that the folder changed: cwd used, and the empty list in words', () => {
    render(<PermissionsPanel session={session} feed={feed({ kind: 'ok', data: data([], { cwd: '/w/moved', cwdNote: 'cwd used: /w/moved (the session moved from /w/shop)' }) })} />);
    expect(screen.getByText('cwd used: /w/moved (the session moved from /w/shop)')).toBeInTheDocument();
    expect(screen.getByText('No active bypass for this session.')).toBeInTheDocument();
  });

  it('a CLI failure is an alert with the message and the fix; the list is not shown as empty and the files do not replace it', () => {
    render(<PermissionsPanel session={session} feed={feed({ kind: 'error', text: 'x is not valid JSON. Fix or delete the file.', cwd: '/w/shop', cwdNote: '' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('The bypasses of this session could not be read from the plugin: x is not valid JSON. Fix or delete the file.');
    expect(screen.queryByText('No active bypass for this session.')).toBeNull();
    expect(screen.queryByText('read from files (admin CLI not found)')).toBeNull();
  });

  it('Revoke asks for a confirmation that names the category and the time left; Cancel sends nothing', () => {
    const { calls } = stubFetch({});
    render(<PermissionsPanel session={session} feed={feed({ kind: 'ok', data: data([cliGrant('a1b2c3d4')]) })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke the rm bypass' }));
    expect(screen.getByText('Revoke the rm bypass (10 min left)? The guardrail applies again to this session at once.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Confirm revoke' })).toBeNull();
    expect(calls.filter((call) => call.method === 'POST')).toEqual([]);
  });

  it('Confirm sends the revoke with the session id only (through the PIN fetcher), shows the result and reloads the list', async () => {
    const reload = vi.fn();
    const { calls } = stubFetch({ ...CSRF, [REVOKE]: { body: { ok: true, id: 'a1b2c3d4', category: 'rm', sessionId: SID, cwd: '/w/shop', auditError: '' } } });
    render(<PermissionsPanel session={session} feed={feed({ kind: 'ok', data: data([cliGrant('a1b2c3d4')]) }, { reload })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke the rm bypass' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Revoked the rm bypass (a1b2c3d4). The guardrail applies again to this session.');
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ sessionId: SID });
    expect(reload).toHaveBeenCalled();
  });

  it('a refusal (PIN cancelled, grant gone, plugin error) is an alert with the server text; the row stays and nothing claims success', async () => {
    stubFetch({ ...CSRF, [REVOKE]: { status: 409, body: { ok: false, error: { code: 'grant-not-found', message: 'No active bypass a1b2c3d4 for session x', hint: 'Refresh the list.' } } } });
    const reload = vi.fn();
    render(<PermissionsPanel session={session} feed={feed({ kind: 'ok', data: data([cliGrant('a1b2c3d4')]) }, { reload })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke the rm bypass' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The rm bypass a1b2c3d4 was not revoked. No active bypass a1b2c3d4 for session x. Refresh the list.'));
    expect(screen.queryByRole('status')).toBeNull();
    expect(document.querySelector('[data-cli-grant="a1b2c3d4"]')).not.toBeNull();
    expect(reload).toHaveBeenCalled();
  });

  it('a revoke whose audit line failed says so as a warning next to the success', async () => {
    stubFetch({ ...CSRF, [REVOKE]: { body: { ok: true, id: 'a1b2c3d4', category: 'rm', sessionId: SID, cwd: '/w/shop', auditError: 'The audit line could not be written to /c/audit: EACCES. The bypass IS revoked.' } } });
    render(<PermissionsPanel session={session} feed={feed({ kind: 'ok', data: data([cliGrant('a1b2c3d4')]) })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Revoke the rm bypass' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm revoke' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Revoked the rm bypass (a1b2c3d4)');
    expect(screen.getByRole('alert')).toHaveTextContent('The audit line could not be written');
  });
});
