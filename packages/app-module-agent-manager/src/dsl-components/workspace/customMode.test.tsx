import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UrlParamContext, type UrlParamService } from '@wadeck-app/dsl-ui';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { seedCsrfToken } from '../data/http.js';
import { row } from '../logic/fixtures.js';
import { stubFetch } from '../owned/testFetch.js';
import type { CustomGroupDto, SessionRowDto } from '../shared.js';
import { applyPatch, reflected } from './useOptimisticRows.js';
import { Workspace } from './Workspace.js';

beforeEach(() => {
  window.localStorage.clear();
  seedCsrfToken('test-token');
});
afterEach(() => vi.unstubAllGlobals());

const group = (id: string, name: string, order: number): CustomGroupDto => ({ id, name, color: null, collapsed: false, order, sort: 'manual', bodyColor: null });

function Page({ sessions, customGroups }: { sessions: SessionRowDto[]; customGroups: CustomGroupDto[] }) {
  const [params, setParams] = useState<Record<string, string>>({ mode: 'custom' });
  const service: UrlParamService = { get: (key) => (params[key] === '' ? null : (params[key] ?? null)), set: (key, value) => setParams((current) => ({ ...current, [key]: value })) };
  return (
    <UrlParamContext.Provider value={service}>
      <Workspace sessions={sessions} customGroups={customGroups} userStateError="" hiddenDead={0} ownedError={null} ownedErrorText="" />
    </UrlParamContext.Provider>
  );
}

describe('the Custom mode in the workspace', () => {
  it('is a fourth mode of the toggle, opened by ?mode=custom, with the New group button', () => {
    stubFetch({});
    render(<Page sessions={[row({ displayName: 'shop-agent' })]} customGroups={[group('11111111-1111-4111-8111-111111111111', 'Focus', 0)]} />);
    fireEvent.click(screen.getByRole('button', { name: 'List layout and view options' }));
    expect(screen.getByRole('radio', { name: /^Custom/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('tree', { name: 'Agents by custom group' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New group' })).toBeInTheDocument();
  });

  it('with no group, the list says to use New group, offers no preset and lists no group', () => {
    const { calls } = stubFetch({});
    render(<Page sessions={[row({ displayName: 'shop-agent' })]} customGroups={[]} />);
    expect(screen.getByText(/No custom group yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New group' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Herdr/ })).toBeNull();
    expect(screen.queryByRole('treeitem', { name: /Icebox/ })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('flags an agent at once and sends the mark', async () => {
    const agent = row({ displayName: 'shop-agent', customGroupId: '11111111-1111-4111-8111-111111111111', customGroupOrder: 0 });
    const { calls } = stubFetch({ [`POST /sessions/${agent.sessionId}/marks`]: { body: { ok: true } } });
    render(<Page sessions={[agent]} customGroups={[group('11111111-1111-4111-8111-111111111111', 'Focus', 0)]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actions of shop-agent' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Flag' }));
    expect(await screen.findByText('Flagged')).toBeInTheDocument();
    await waitFor(() => expect(calls.some((call) => call.path.endsWith('/marks'))).toBe(true));
    expect(calls.find((call) => call.path.endsWith('/marks'))?.body).toEqual({ flag: true });
  });

  it('selecting an agent marked unread reads it: the mark is cleared at once and on the server', async () => {
    const agent = row({ displayName: 'shop-agent', customGroupId: '11111111-1111-4111-8111-111111111111', customGroupOrder: 0, state: 'idle', unread: true });
    const { calls } = stubFetch({ [`POST /sessions/${agent.sessionId}/marks`]: { body: { ok: true } } });
    const { container } = render(<Page sessions={[agent]} customGroups={[group('11111111-1111-4111-8111-111111111111', 'Focus', 0)]} />);
    const rowElement = container.querySelector<HTMLElement>(`[data-session-id="${agent.sessionId.toLowerCase()}"]`) as HTMLElement;
    // shown as finished and unseen until it is selected
    expect(rowElement.querySelector('[data-herdr-light="dot"]')).not.toBeNull();
    await userEvent.click(rowElement);
    await waitFor(() => expect(calls.find((call) => call.path.endsWith('/marks'))?.body).toEqual({ unread: false }));
    await waitFor(() => expect(rowElement.querySelector('[data-herdr-light="ring"]')).not.toBeNull());
  });
});

describe('the mark patches of the optimistic rows', () => {
  const base = row({ flagged: false, unread: true });
  it('applies a flag or an unread change and knows when the server shows it', () => {
    expect(applyPatch(base, { kind: 'marks', flag: true })).toMatchObject({ flagged: true, unread: true });
    expect(applyPatch(base, { kind: 'marks', unread: false })).toMatchObject({ flagged: false, unread: false });
    expect(reflected({ ...base, flagged: true }, { kind: 'marks', flag: true })).toBe(true);
    expect(reflected(base, { kind: 'marks', flag: true })).toBe(false);
    expect(reflected(base, { kind: 'marks', unread: true })).toBe(true);
  });
});
