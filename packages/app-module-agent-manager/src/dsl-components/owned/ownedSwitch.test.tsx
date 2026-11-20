import { render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DetailHeader } from '../detail/DetailHeader.js';
import { ownedDto, ownedRow } from '../logic/fixtures.js';
import { applyOwnedDto, ownedStateChip, rowFromOwned } from '../logic/owned.js';
import { OwnedStateChip } from './OwnedStateChip.js';
import { stubFetch } from './testFetch.js';
import { useOwnedSession } from './useOwnedSession.js';

afterEach(() => vi.unstubAllGlobals());

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const interrupted = (id: string) => ownedRow({ sessionId: id, ownedState: 'interrupted', alive: false, state: 'ended' });
const listed = { body: { ok: true, generatedAt: 'now', daemon: {}, sessions: [ownedDto({ id: A, status: 'interrupted', state: 'interrupted', resumable: true, leftoverPid: 4242, note: 'Note of A' }), ownedDto({ id: B, status: 'interrupted', state: 'interrupted', resumable: true })] } };

const header = (session: ReturnType<typeof ownedRow>) => <DetailHeader session={session} now={2_000_000} busy={false} onBack={() => undefined} onTogglePin={() => undefined} onMarkSeen={() => undefined} onOwnedChange={() => undefined} onForgotten={() => undefined} />;

describe('the owned header when another session is selected', () => {
  it('drops the note, the error and the record of the previous session, and never sends its leftover acknowledgement', async () => {
    const { calls } = stubFetch({
      'GET /owned': listed,
      [`POST /owned/${A}/resume`]: { status: 409, body: { ok: false, error: { code: 'leftover-alive', message: 'A claude process of A is alive', hint: 'Check it' } } },
      [`POST /owned/${B}/resume`]: { body: { ok: true, session: ownedDto({ id: B }) } },
    });
    const view = render(header(interrupted(A)));
    expect(await screen.findByText('Note of A')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Resume anyway' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Resume anyway' }));
    expect(await screen.findByText(/A claude process of A is alive/)).toBeInTheDocument();

    view.rerender(header(interrupted(B)));
    // Nothing of A is left: no dialog, no error, no note, no leftover wording.
    expect(screen.queryByText(/A claude process of A is alive/)).toBeNull();
    expect(screen.queryByText('Note of A')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resume anyway' })).toBeNull();
    await userEvent.click(await screen.findByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(calls.some((call) => call.path === `/owned/${B}/resume`)).toBe(true));
    const resumeOfB = calls.find((call) => call.path === `/owned/${B}/resume`);
    // The shell fetcher sends {} for a write without a body: what matters is that no acknowledgeLeftover goes along.
    expect(resumeOfB?.body).toEqual({});
    expect(calls.filter((call) => call.path === `/owned/${A}/resume`).map((call) => call.body)).toEqual([{ acknowledgeLeftover: true }]);
  });

  it('the hook answers empty for a new session id until its own answer arrives', async () => {
    stubFetch({ 'GET /owned': listed });
    const { result, rerender } = renderHook(({ id }) => useOwnedSession(id, 'interrupted', true), { initialProps: { id: A } });
    await waitFor(() => expect(result.current.dto?.leftoverPid).toBe(4242));
    rerender({ id: B });
    // The same render already says nothing about A.
    expect(result.current.dto).toBeUndefined();
    await waitFor(() => expect(result.current.dto?.id).toBe(B));
    expect(result.current.dto?.leftoverPid).toBeUndefined();
  });
});

describe('an owned state this page does not know', () => {
  it('shows the raw state in a chip and never throws', () => {
    const chip = ownedStateChip({ launchedBy: 'agent-manager', ownedState: 'unknown', ownedRawState: 'paused', registryPending: false, pendingPermissions: 0 });
    expect(chip).toMatchObject({ label: 'unknown: paused', tone: 'warning', quiet: false });
    // A value outside the contract (a newer module/daemon pair) does not throw either.
    expect(() => ownedStateChip({ launchedBy: 'agent-manager', ownedState: 'hibernating' as never, registryPending: false, pendingPermissions: 0 })).not.toThrow();
    const view = render(<OwnedStateChip session={{ launchedBy: 'agent-manager', ownedState: 'unknown', ownedRawState: 'paused', registryPending: false, pendingPermissions: 0 }} compact />);
    expect(view.container).toHaveTextContent('unknown: paused');
  });

  it('builds rows with state other and status unknown, alive or not', () => {
    const dto = ownedDto({ state: 'unknown', rawState: 'paused' });
    expect(rowFromOwned(dto, 0)).toMatchObject({ state: 'other', status: 'unknown', ownedState: 'unknown', ownedRawState: 'paused' });
    expect(applyOwnedDto(ownedRow(), ownedDto({ state: 'unknown', rawState: 'paused', status: 'exited' }))).toMatchObject({ state: 'other', status: 'unknown', ownedRawState: 'paused' });
  });

  it('a header for such a session renders', () => {
    stubFetch({ 'GET /owned': { body: { ok: true, generatedAt: 'now', daemon: {}, sessions: [ownedDto({ id: A, state: 'unknown', rawState: 'paused' })] } } });
    render(header(ownedRow({ sessionId: A, ownedState: 'unknown', ownedRawState: 'paused', state: 'other', status: 'unknown' })));
    expect(screen.getByText('unknown: paused')).toBeInTheDocument();
  });
});
