import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ownedRow } from '../logic/fixtures.js';
import type { OwnedPermissionDto } from '../shared.js';
import { PermissionCard } from './PermissionCard.js';
import { stubFetch, type Call } from './testFetch.js';
import { FAST_POLL_MS, SLOW_POLL_MS } from './usePermissions.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const ID = '11111111-1111-4111-8111-111111111111';
const request = (patch: Partial<OwnedPermissionDto> = {}): OwnedPermissionDto => ({
  requestId: 'req-1',
  toolName: 'Bash',
  input: { command: 'npm test', description: 'Run the tests' },
  description: 'Run the unit tests of the project',
  receivedAt: 100,
  ...patch,
});
const waitingRow = () => ownedRow({ sessionId: ID, ownedState: 'requires_action', pendingPermissions: 1, state: 'needs-you' });
const listed = (...permissions: OwnedPermissionDto[]) => ({ body: { ok: true, sessionId: ID, permissions } });

describe('PermissionCard: what is shown', () => {
  it('shows the tool, its description and the exact command, and no shortcut key answers it', async () => {
    stubFetch({ [`GET /owned/${ID}/permissions`]: listed(request()) });
    render(<PermissionCard session={waitingRow()} />);
    const card = await screen.findByRole('region', { name: 'Permission requests' });
    expect(card).toHaveTextContent('Permission request: Bash');
    expect(card).toHaveTextContent('Run the unit tests of the project');
    expect(card.querySelector('[data-permission-input] pre')?.textContent).toBe('npm test');
    expect(card).toHaveTextContent('Other fields');
    expect(card).toHaveTextContent('"description": "Run the tests"');
    // Neither button holds the focus nor an access key: a stray Enter or Space answers nothing.
    expect(document.activeElement).toBe(document.body);
    for (const name of ['Allow once', 'Deny']) {
      expect(screen.getByRole('button', { name })).not.toHaveAttribute('accesskey');
    }
    await userEvent.keyboard('{Enter} ya');
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeEnabled();
  });

  it('folds a large input behind a visible button that says how much is hidden, and opens all of it', async () => {
    const big = Array.from({ length: 40 }, (_, index) => `line ${index} of a long script`).join('\n');
    stubFetch({ [`GET /owned/${ID}/permissions`]: listed(request({ input: { command: big } })) });
    render(<PermissionCard session={waitingRow()} />);
    const toggle = await screen.findByRole('button', { name: /Show all \(40 lines/ });
    const block = document.querySelector('[data-permission-input] pre') as HTMLElement;
    // The whole text is in the page, folded by the display only.
    expect(block.textContent).toBe(big);
    expect(block.className).toContain('line-clamp-3');
    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Fold it' })).toHaveAttribute('aria-expanded', 'true');
    expect(block.className).not.toContain('line-clamp-3');
  });

  it('renders nothing for a session that is not a live Web session, and does not ask', async () => {
    const { calls } = stubFetch({});
    const { container } = render(<PermissionCard session={ownedRow({ host: 'hc', ownedState: 'unobserved' })} />);
    expect(container).toBeEmptyDOMElement();
    const ended = render(<PermissionCard session={ownedRow({ ownedState: 'exited' })} />);
    expect(ended.container).toBeEmptyDOMElement();
    expect(calls).toHaveLength(0);
  });

  it('says so when the permission requests cannot be read (a request may wait unseen)', async () => {
    stubFetch({ [`GET /owned/${ID}/permissions`]: { body: { ok: false, error: { code: 'daemon-unreachable', message: 'The daemon does not answer', hint: 'Run agent-manager status' } } } });
    render(<PermissionCard session={waitingRow()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/may be waiting that you cannot see\. The daemon does not answer\. Run agent-manager status/);
  });
});

describe('PermissionCard: answering', () => {
  it('Allow posts a plain allow through the CSRF client, shows the result and drops the request', async () => {
    let pending = [request()];
    const { calls } = stubFetch({
      [`GET /owned/${ID}/permissions`]: () => listed(...pending),
      [`POST /owned/${ID}/permissions/req-1`]: () => {
        pending = [];
        return { body: { ok: true, sessionId: ID, requestId: 'req-1', decision: 'allow' } };
      },
    });
    render(<PermissionCard session={waitingRow()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Allow once' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Allowed Bash once. The agent continues.');
    const post = calls.find((call) => call.method === 'POST') as Call;
    expect(post.body).toEqual({ decision: 'allow' });
    expect(post.headers['X-Agent-Manager-Csrf']).toBe('test-token');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Allow once' })).toBeNull());
  });

  it('Deny carries the optional reason, and leaves it out when empty', async () => {
    const { calls } = stubFetch({
      [`GET /owned/${ID}/permissions`]: listed(request(), request({ requestId: 'req-2', toolName: 'Write', description: undefined, input: { file_path: 'a.txt', content: 'x' }, receivedAt: 200 })),
      [`POST /owned/${ID}/permissions/req-1`]: { body: { ok: true, sessionId: ID, requestId: 'req-1', decision: 'deny' } },
      [`POST /owned/${ID}/permissions/req-2`]: { body: { ok: true, sessionId: ID, requestId: 'req-2', decision: 'deny' } },
    });
    render(<PermissionCard session={waitingRow()} />);
    await userEvent.type(await screen.findByLabelText(/Reason for the agent if you deny/), 'not on main');
    await userEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(await screen.findByText(/Denied Bash\. The agent was told: not on main\./)).toBeInTheDocument();
    // The next request is now the current one, with an empty reason.
    await screen.findByRole('heading', { name: 'Permission request: Write' });
    await userEvent.click(screen.getByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2));
    expect(calls.filter((call) => call.method === 'POST').map((call) => call.body)).toEqual([{ decision: 'deny', message: 'not on main' }, { decision: 'deny' }]);
  });

  it('queues several requests: the oldest is answered, the others wait as lines behind it', async () => {
    stubFetch({
      [`GET /owned/${ID}/permissions`]: listed(request({ requestId: 'b', toolName: 'Write', description: 'Write a.txt', receivedAt: 300 }), request({ requestId: 'a', receivedAt: 100 }), request({ requestId: 'c', toolName: 'Edit', description: undefined, receivedAt: 400 })),
    });
    render(<PermissionCard session={waitingRow()} />);
    const heading = await screen.findByRole('heading', { name: 'Permission request: Bash' });
    expect(heading.parentElement).toHaveTextContent('1 of 3');
    const queue = screen.getByRole('list', { name: 'Requests waiting behind this one' });
    expect(within(queue).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Next: Write, Write a.txt', 'Next: Edit']);
    expect(screen.getAllByRole('button', { name: 'Allow once' })).toHaveLength(1);
  });

  it('disables both buttons while a decision is in flight', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    stubFetch({
      [`GET /owned/${ID}/permissions`]: listed(request()),
      [`POST /owned/${ID}/permissions/req-1`]: async () => {
        await gate;
        return { body: { ok: true, sessionId: ID, requestId: 'req-1', decision: 'allow' } };
      },
    });
    render(<PermissionCard session={waitingRow()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Allow once' }));
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Deny' })).toBeDisabled();
    await act(async () => {
      release();
      await gate;
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Allow once' })).toBeNull());
  });

  it('a refused decision stays on screen with the daemon text, the request stays answerable, the list is read again', async () => {
    const { calls } = stubFetch({
      [`GET /owned/${ID}/permissions`]: listed(request()),
      [`POST /owned/${ID}/permissions/req-1`]: { status: 404, body: { ok: false, error: { code: 'unknown-permission-request', message: 'No permission request req-1 waits for this session', hint: 'It was answered already, or the session ended' } } },
    });
    render(<PermissionCard session={waitingRow()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Allow once' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The Bash request was not allowed. No permission request req-1 waits for this session. It was answered already, or the session ended');
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeEnabled();
    await waitFor(() => expect(calls.filter((call) => call.method === 'GET').length).toBeGreaterThan(1));
  });

  it('never puts a token in a URL, a header of the read, or the page', async () => {
    const { calls } = stubFetch({
      [`GET /owned/${ID}/permissions`]: listed(request()),
      [`POST /owned/${ID}/permissions/req-1`]: { body: { ok: true, sessionId: ID, requestId: 'req-1', decision: 'allow' } },
    });
    const view = render(<PermissionCard session={waitingRow()} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Allow once' }));
    await screen.findByRole('status');
    // The module holds the daemon token; the page only sends the write token on a POST.
    for (const call of calls) {
      expect(call.path).not.toMatch(/token|bearer/i);
      if (call.method === 'GET') {
        expect(Object.keys(call.headers)).toEqual([]);
      } else {
        expect(Object.keys(call.headers).map((name) => name.toLowerCase()).sort()).toEqual(['content-type', 'x-agent-manager-csrf']);
      }
    }
    expect(view.container.textContent).not.toContain('test-token');
    expect(document.body.innerHTML).not.toMatch(/bearer|authorization/i);
  });
});

describe('PermissionCard: polling', () => {
  it('polls every 2 s while a request waits and every 5 s on a quiet live Web session', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fast = stubFetch({ [`GET /owned/${ID}/permissions`]: listed() });
    const view = render(<PermissionCard session={waitingRow()} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    const afterFirst = fast.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FAST_POLL_MS + 50);
    });
    expect(fast.calls.length).toBe(afterFirst + 1);
    view.unmount();

    const slow = stubFetch({ [`GET /owned/${ID}/permissions`]: listed() });
    render(<PermissionCard session={ownedRow({ sessionId: ID, ownedState: 'idle' })} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    const slowFirst = slow.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(FAST_POLL_MS + 50);
    });
    expect(slow.calls.length).toBe(slowFirst);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SLOW_POLL_MS - FAST_POLL_MS);
    });
    expect(slow.calls.length).toBe(slowFirst + 1);
  });
});
