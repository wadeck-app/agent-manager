import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UrlParamContext, type UrlParamService } from '@wadeck-app/dsl-ui';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ownedDto, ownedRow, row } from '../logic/fixtures.js';
import { stubFetch } from '../owned/testFetch.js';
import { Workspace } from '../workspace/Workspace.js';
import { DetailHeader } from './DetailHeader.js';

afterEach(() => vi.unstubAllGlobals());

const SOURCE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const FORK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function header(session: ReturnType<typeof row>, extra: Partial<Parameters<typeof DetailHeader>[0]> = {}) {
  return <DetailHeader session={session} now={2_000_000} busy={false} onBack={() => undefined} onTogglePin={() => undefined} onMarkSeen={() => undefined} onOwnedChange={() => undefined} onForgotten={() => undefined} onForked={() => undefined} onOpenSource={() => undefined} {...extra} />;
}

describe('the Fork action of the detail header', () => {
  it('is offered for a discovered session and opens the dialog', async () => {
    stubFetch({});
    render(header(row({ sessionId: SOURCE, displayName: 'terminal one' })));
    const button = screen.getByRole('button', { name: 'Fork' });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(screen.getByRole('dialog', { name: 'Fork terminal one' })).toBeInTheDocument();
  });

  it('is disabled for a session that has no message yet, and the tooltip says why', async () => {
    stubFetch({});
    render(header(ownedRow({ sessionId: SOURCE, registryPending: true })));
    const button = screen.getByRole('button', { name: 'Fork' });
    expect(button).toBeDisabled();
    await userEvent.hover(button.parentElement as HTMLElement);
    expect(await screen.findByText(/no message yet, so there is no conversation to fork/)).toBeInTheDocument();
  });

  it('is also offered for a background or terminal session: the fork is a Web session on their transcript', () => {
    stubFetch({ 'GET /owned': { body: { ok: true, generatedAt: 'now', daemon: {}, sessions: [] } } });
    render(header(ownedRow({ sessionId: SOURCE, host: 'hc', ownedState: 'unobserved' })));
    expect(screen.getByRole('button', { name: 'Fork' })).toBeEnabled();
  });
});

describe('the Fork dialog follows the selected session', () => {
  it('closes when another session is selected, and never forks the one the user did not click on', async () => {
    const { calls } = stubFetch({});
    const A = row({ sessionId: SOURCE, displayName: 'first' });
    const B = row({ sessionId: FORK, displayName: 'second' });
    const view = render(header(A));
    await userEvent.click(screen.getByRole('button', { name: 'Fork' }));
    expect(screen.getByRole('dialog', { name: 'Fork first' })).toBeInTheDocument();
    view.rerender(header(B));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.some((call) => call.path === '/owned/fork')).toBe(false);
    // Coming back to the first does not reopen it either: the user clicks again.
    view.rerender(header(A));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('forked from', () => {
  it('says "forked from <name>" with a way to open the source when it is listed', async () => {
    stubFetch({ 'GET /owned': { body: { ok: true, generatedAt: 'now', daemon: {}, sessions: [ownedDto({ id: FORK, forkedFrom: SOURCE })] } } });
    const onOpenSource = vi.fn();
    render(header(ownedRow({ sessionId: FORK, forkedFrom: SOURCE }), { forkedFrom: { id: SOURCE, name: 'shop' }, onOpenSource }));
    const line = document.querySelector('[data-forked-from]') as HTMLElement;
    expect(line).toHaveTextContent('forked from shop');
    await userEvent.click(screen.getByRole('button', { name: 'shop' }));
    expect(onOpenSource).toHaveBeenCalledWith(SOURCE);
  });

  it('names the short id and says the source is not in the list when it is gone (no dead link)', () => {
    stubFetch({ 'GET /owned': { body: { ok: true, generatedAt: 'now', daemon: {}, sessions: [] } } });
    render(header(ownedRow({ sessionId: FORK, forkedFrom: SOURCE }), { forkedFrom: { id: SOURCE, name: undefined } }));
    expect(document.querySelector('[data-forked-from]')).toHaveTextContent('forked from aaaaaaaa (not in the list)');
    expect(screen.queryByRole('button', { name: /aaaaaaaa/ })).toBeNull();
  });

  it('is absent for a session that is not a fork', () => {
    stubFetch({});
    render(header(row({ sessionId: SOURCE })));
    expect(document.querySelector('[data-forked-from]')).toBeNull();
  });
});

describe('forking from the workspace', () => {
  function Page({ sessions }: { sessions: ReturnType<typeof row>[] }) {
    const [params, setParams] = useState<Record<string, string>>({ session: SOURCE });
    const service: UrlParamService = { get: (key) => params[key] ?? null, set: (key, value) => setParams((current) => ({ ...current, [key]: value })) };
    return (
      <UrlParamContext.Provider value={service}>
        <Workspace sessions={sessions} userStateError="" hiddenDead={0} ownedError={null} ownedErrorText="" />
        <div data-testid="session-param">{params['session'] ?? ''}</div>
      </UrlParamContext.Provider>
    );
  }

  it('lists the fork at once as starting, selects it and shows where it comes from', async () => {
    stubFetch({ 'POST /owned/fork': { body: { ok: true, session: ownedDto({ id: FORK, name: 'fork of shop', forkedFrom: SOURCE, cwd: '/work/shop' }) } }, 'GET /owned': { body: { ok: true, generatedAt: 'now', daemon: {}, sessions: [] } } });
    render(<Page sessions={[row({ sessionId: SOURCE, displayName: 'shop' })]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Fork' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Fork' }));
    await waitFor(() => expect(screen.getByTestId('session-param')).toHaveTextContent(FORK));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.querySelector(`[data-session-id="${FORK}"]`)).toHaveAttribute('aria-selected', 'true');
    expect(document.querySelector('[data-forked-from]')).toHaveTextContent('forked from shop');
  });
});
