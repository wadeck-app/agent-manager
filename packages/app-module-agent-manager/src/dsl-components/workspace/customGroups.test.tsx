import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UrlParamContext, type UrlParamService } from '@wadeck-app/dsl-ui';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedCsrfToken } from '../data/http.js';
import { row } from '../logic/fixtures.js';
import { stubFetch } from '../owned/testFetch.js';
import type { CustomGroupDto, SessionRowDto } from '../shared.js';
import { useCustomGroups, type SendGroupRequest } from './useCustomGroups.js';
import { expectNoticeDetails } from '../ui/noticeTestKit.js';
import { Workspace } from './Workspace.js';

beforeEach(() => {
  window.localStorage.clear();
  seedCsrfToken('test-token');
});
afterEach(() => vi.unstubAllGlobals());

const group = (id: string, order: number): CustomGroupDto => ({ id, name: `Group ${id}`, color: null, collapsed: false, order, sort: 'manual', bodyColor: null });

function Page({ sessions, customGroups, mode = '' }: { sessions: SessionRowDto[]; customGroups: CustomGroupDto[]; mode?: string }) {
  const [params, setParams] = useState<Record<string, string>>({ mode });
  const service: UrlParamService = { get: (key) => (params[key] === '' ? null : (params[key] ?? null)), set: (key, value) => setParams((current) => ({ ...current, [key]: value })) };
  return (
    <UrlParamContext.Provider value={service}>
      <Workspace sessions={sessions} customGroups={customGroups} userStateError="" hiddenDead={0} ownedError={null} ownedErrorText="" />
    </UrlParamContext.Provider>
  );
}

describe('the custom groups in the workspace', () => {
  const one = row({ folder: 'shop', displayName: 'shop-agent' });
  const two = row({ folder: 'docs', displayName: 'docs-agent' });

  it('the New group button creates a group on the server and lists it at once', async () => {
    const { calls } = stubFetch({
      'POST /groups': { body: { ok: true, group: { id: '11111111-1111-4111-8111-111111111111', name: 'Reviews', color: null, collapsed: false, order: 0 } } },
    });
    render(<Page sessions={[one, two]} customGroups={[]} />);
    expect(screen.queryByText(/Ungrouped/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'New group' }));
    await userEvent.type(screen.getByLabelText('Name of the new group'), 'Reviews{Enter}');
    await waitFor(() => expect(screen.getByText('Reviews')).toBeInTheDocument());
    expect(calls.find((call) => call.path === '/groups')?.body).toEqual({ name: 'Reviews' });
    expect(screen.getByText('Ungrouped, by workspace')).toBeInTheDocument();
    // the field is gone, the button is back
    expect(screen.getByRole('button', { name: 'New group' })).toBeInTheDocument();
  });

  it('only the Tree lists the groups, so only the Tree offers the New group button', () => {
    stubFetch({});
    const { unmount } = render(<Page sessions={[one]} customGroups={[]} mode="groups" />);
    expect(screen.queryByRole('button', { name: 'New group' })).toBeNull();
    unmount();
    render(<Page sessions={[one]} customGroups={[]} mode="inbox" />);
    expect(screen.queryByRole('button', { name: 'New group' })).toBeNull();
  });

  it('a refusal of the server is said in the banner and the field stays', async () => {
    stubFetch({ 'POST /groups': { status: 409, body: { ok: false, message: 'Too many groups (limit 50)', hint: 'Delete a group you no longer use.' } } });
    render(<Page sessions={[one]} customGroups={[]} />);
    await userEvent.click(screen.getByRole('button', { name: 'New group' }));
    await userEvent.type(screen.getByLabelText('Name of the new group'), 'Reviews{Enter}');
    await expectNoticeDetails(/Could not create the group: Too many groups \(limit 50\)\. Delete a group you no longer use\./);
    expect(screen.getByLabelText('Name of the new group')).toBeInTheDocument();
  });

  it('moving an agent through the dialog shows it in the group at once and sends the move', async () => {
    const { calls } = stubFetch({ [`POST /sessions/${one.sessionId}/group`]: { body: { ok: true } } });
    const { container } = render(<Page sessions={[one, two]} customGroups={[group('a', 0)]} />);
    const target = container.querySelector<HTMLElement>(`[data-session-id="${one.sessionId}"]`)!;
    fireEvent.keyDown(target, { key: 'm' });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Group a/ }));
    // optimistic: the agent is under the group header before any poll
    const header = container.querySelector<HTMLElement>('[data-group-id="a"]')!;
    expect(header).toHaveTextContent('1');
    expect(within(container.querySelector<HTMLElement>('[data-custom-group="a"]')!).getByText('shop-agent')).toBeInTheDocument();
    await waitFor(() => expect(calls.some((call) => call.path === `/sessions/${one.sessionId}/group`)).toBe(true));
    expect(calls.find((call) => call.path.endsWith('/group'))?.body).toEqual({ groupId: 'a', beforeSessionId: null });
  });

  it('a refused move goes back to the server layout and says why', async () => {
    stubFetch({ [`POST /sessions/${one.sessionId}/group`]: { status: 404, body: { ok: false, message: 'No group a', hint: 'It may have been deleted since the page was loaded (from another tab).' } } });
    const { container } = render(<Page sessions={[one, two]} customGroups={[group('a', 0)]} />);
    fireEvent.keyDown(container.querySelector<HTMLElement>(`[data-session-id="${one.sessionId}"]`)!, { key: 'm' });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Group a/ }));
    await expectNoticeDetails(/Could not move the agent: No group a/);
    await waitFor(() => expect(container.querySelector<HTMLElement>('[data-group-id="a"]')).toHaveTextContent('0'));
    expect(within(container.querySelector<HTMLElement>('[data-ungrouped]')!).getByText('shop-agent')).toBeInTheDocument();
  });
});

describe('a refused drop in the workspace', () => {
  it('says why, undoes only that move, and keeps the other one', async () => {
    const one = row({ folder: 'shop', displayName: 'shop-agent' });
    const two = row({ folder: 'docs', displayName: 'docs-agent' });
    stubFetch({
      [`POST /sessions/${one.sessionId}/group`]: { status: 404, body: { ok: false, message: 'No group a', hint: 'It may have been deleted since the page was loaded (from another tab).' } },
      [`POST /sessions/${two.sessionId}/group`]: { body: { ok: true } },
    });
    const { container } = render(<Page sessions={[one, two]} customGroups={[group('a', 0)]} />);
    for (const session of [one, two]) {
      fireEvent.keyDown(container.querySelector<HTMLElement>(`[data-session-id="${session.sessionId}"]`)!, { key: 'm' });
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Group a/ }));
    }
    await expectNoticeDetails(/Could not move the agent: No group a. It may have been deleted/);
    const inGroup = container.querySelector<HTMLElement>('[data-custom-group="a"]')!;
    expect(within(inGroup).queryByText('shop-agent')).toBeNull();
    expect(within(inGroup).getByText('docs-agent')).toBeInTheDocument();
  });
});

describe('useCustomGroups', () => {
  const a = row({ customGroupId: 'g', customGroupOrder: 0 });
  const b = row();
  const ok: SendGroupRequest = () => Promise.resolve({ ok: true, value: undefined });

  it('keeps the local move until the poll shows it, then follows the server', () => {
    const { result, rerender } = renderHook((props: { rows: SessionRowDto[] }) => useCustomGroups(props.rows, [group('g', 0)], ok), { initialProps: { rows: [a, b] } });
    act(() => result.current.api.move(b.sessionId, 'g', null));
    expect(result.current.rows.map((r) => [r.customGroupId, r.customGroupOrder])).toEqual([['g', 0], ['g', 1]]);
    // a poll that does not show it yet (the request is still in flight): the local layout stays
    rerender({ rows: [{ ...a }, { ...b }] });
    expect(result.current.rows[1]?.customGroupId).toBe('g');
    // the poll that shows it: the server rows are used again
    const served = [a, { ...b, customGroupId: 'g', customGroupOrder: 1 }];
    rerender({ rows: served });
    expect(result.current.rows[1]).toBe(served[1]);
  });

  it('goes back to the server layout when the request fails', async () => {
    const failing: SendGroupRequest = () => Promise.resolve({ ok: false });
    const { result } = renderHook(() => useCustomGroups([a, b], [group('g', 0)], failing));
    act(() => result.current.api.move(b.sessionId, 'g', null));
    await waitFor(() => expect(result.current.rows[1]?.customGroupId).toBeNull());
  });

  it('drops a local change after the time to live whatever the server shows', () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook((props: { rows: SessionRowDto[] }) => useCustomGroups(props.rows, [group('g', 0)], ok), { initialProps: { rows: [a, b] } });
      act(() => result.current.api.move(b.sessionId, 'g', null));
      vi.setSystemTime(Date.now() + 25_000);
      rerender({ rows: [{ ...a }, { ...b }] });
      expect(result.current.rows[1]?.customGroupId).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rename, collapse, reorder and delete show at once and send the right request', async () => {
    const sent: [string, unknown][] = [];
    const send: SendGroupRequest = (path, body) => {
      sent.push([path, body]);
      return Promise.resolve({ ok: true, value: undefined });
    };
    const { result } = renderHook(() => useCustomGroups([a, b], [group('g', 0), group('h', 1)], send));
    act(() => result.current.api.update('g', { name: 'Renamed', collapsed: true }));
    expect(result.current.api.groups[0]).toMatchObject({ name: 'Renamed', collapsed: true });
    act(() => result.current.api.reorder(['h', 'g']));
    expect(result.current.api.groups.map((g) => g.id)).toEqual(['h', 'g']);
    act(() => result.current.api.remove('g'));
    expect(result.current.api.groups.map((g) => g.id)).toEqual(['h']);
    expect(result.current.rows[0]?.customGroupId).toBeNull();
    expect(sent).toEqual([
      ['/groups/g', { name: 'Renamed', collapsed: true }],
      ['/groups/order', { ids: ['h', 'g'] }],
      ['/groups/g/delete', undefined],
    ]);
  });

  it('one refused move undoes only itself: a second drop made meanwhile stays', async () => {
    const c = row();
    const resolvers: ((value: { ok: boolean }) => void)[] = [];
    const send: SendGroupRequest = () => new Promise((resolve) => resolvers.push((value) => resolve(value.ok ? { ok: true, value: undefined } : { ok: false })));
    const { result } = renderHook(() => useCustomGroups([a, b, c], [group('g', 0)], send));
    act(() => result.current.api.move(b.sessionId, 'g', null));
    act(() => result.current.api.move(c.sessionId, 'g', null));
    expect(result.current.rows.map((r) => r.customGroupId)).toEqual(['g', 'g', 'g']);
    // the first request is refused; the second is still in flight
    await act(async () => resolvers[0]?.({ ok: false }));
    expect(result.current.rows.map((r) => r.customGroupId)).toEqual(['g', null, 'g']);
    // and the second one succeeds: nothing is undone
    await act(async () => resolvers[1]?.({ ok: true }));
    expect(result.current.rows.map((r) => r.customGroupId)).toEqual(['g', null, 'g']);
    expect(result.current.rows[2]?.customGroupOrder).toBe(1);
  });

  it('ignores a move to a group it does not know or a position that is not a member (nothing is sent)', () => {
    const send = vi.fn(ok);
    const { result } = renderHook(() => useCustomGroups([a, b], [group('g', 0)], send));
    act(() => result.current.api.move(b.sessionId, 'unknown', null));
    act(() => result.current.api.move(b.sessionId, 'g', 'not-a-member'));
    expect(send).not.toHaveBeenCalled();
  });
});
