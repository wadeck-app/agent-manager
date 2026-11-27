import { hoverTip, liveTooltip } from '../detail/status/liveTooltip.js';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ownedDto, ownedRow } from '../logic/fixtures.js';
import { prose } from '../logic/prose.js';
import type { AdoptReadinessDto, SessionRowDto } from '../shared.js';
import { DEFAULT_UI_VARIANTS, type SwitchReadinessVariant } from '../logic/uiVariants.js';
import { UiVariantsContext } from '../ui/UiVariants.js';
import { DaemonStateProvider } from './DaemonState.js';
import { OwnedBar } from './OwnedBar.js';
import { stubFetch } from './testFetch.js';

afterEach(() => vi.unstubAllGlobals());

const ID = '11111111-1111-4111-8111-111111111111';
const LIST = { 'GET /owned': { body: { ok: true, generatedAt: 'now', daemon: {}, sessions: [ownedDto({ id: ID })] } } };
const SWITCH = `POST /owned/${ID}/switch`;
const FREE: AdoptReadinessDto = { state: 'free', reasons: [] };
const BUSY: AdoptReadinessDto = { state: 'busy', reasons: ['Tool Bash `node wait.mjs` is running: its process may keep running unseen after the stop', '1 queued message not yet absorbed: they stay as unanswered lines'] };
const UNKNOWN: AdoptReadinessDto = { state: 'unknown', reasons: ['Cannot tell whether something is running (the transcript cannot be read: locked). Treated as busy.'] };

function switched(hostKind: 'hc' | 'stream-json', notes: string[] = []) {
  return { body: { ok: true, session: ownedDto({ id: ID, hostKind, state: hostKind === 'hc' ? 'unobserved' : 'idle', hcAddress: hostKind === 'hc' ? 't7' : undefined }), from: hostKind === 'hc' ? 'stream-json' : 'hc', to: hostKind, forced: false, readiness: FREE, notes } };
}

function bar(overrides: Partial<SessionRowDto>) {
  const onChange = vi.fn();
  render(<OwnedBar session={ownedRow({ sessionId: ID, ...overrides })} onChange={onChange} onForgotten={vi.fn()} />);
  return { onChange };
}

const wrapper = (): HTMLElement => {
  const found = document.querySelector<HTMLElement>('[data-adopt-button]');
  if (found === null) {
    throw new Error('no Move button on the page');
  }
  return found;
};

const button = (): HTMLElement => {
  const found = document.querySelector<HTMLElement>('[data-adopt-button] button');
  if (found === null) {
    throw new Error('no Move button on the page');
  }
  return found;
};

describe('the hand-over button: the daemon is not running', () => {
  it('is disabled and its title says the daemon is down and how to start it', () => {
    stubFetch({ ...LIST });
    render(
      <DaemonStateProvider down>
        <OwnedBar session={ownedRow({ sessionId: ID, adoptReadiness: FREE })} onChange={vi.fn()} onForgotten={vi.fn()} />
      </DaemonStateProvider>,
    );
    expect(button()).toBeDisabled();
    hoverTip(wrapper());
    expect(liveTooltip().textContent).toMatch(/daemon is not running.*agent-manager start --detach/s);
    // A muted line says the same under the button, and the readiness (which does not need the daemon) stays in words.
    expect(document.querySelector('[data-move-unavailable]')).toHaveTextContent('Daemon not running: agent-manager start --detach');
  });
});

describe('the hand-over button: free', () => {
  it('is neutral, says where it moves, and moves at once without a dialog', async () => {
    const { calls } = stubFetch({ ...LIST, [SWITCH]: switched('hc') });
    const { onChange } = bar({ adoptReadiness: FREE });
    await screen.findByLabelText('Permission mode');
    expect(wrapper()).toHaveTextContent('Hand over to Terminal');
    expect(wrapper()).toHaveAttribute('data-readiness', 'free');
    // The readiness is in words even when it is good news.
    await userEvent.click(button());
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ kind: 'updated', session: expect.objectContaining({ id: ID, hostKind: 'hc' }) }));
    expect(screen.queryByRole('dialog')).toBeNull();
    const post = calls.find((call) => call.method === 'POST' && call.path === `/owned/${ID}/switch`);
    expect(post?.body).toEqual({ target: 'hc', force: false });
    expect(post?.headers['X-Agent-Manager-Csrf']).toBe('test-token');
    expect(await screen.findByText(/now runs as a Terminal session \(herdr-core terminal t7\)/)).toBeInTheDocument();
  });

  it('shows what stays to know after the move (the notes of the daemon)', async () => {
    stubFetch({ ...LIST, [SWITCH]: switched('hc', ['a stale registry file 4242.json (pid 4242) of this session is left in place']) });
    bar({ adoptReadiness: FREE });
    await screen.findByLabelText('Permission mode');
    await userEvent.click(button());
    expect(await screen.findByText(/stale registry file 4242\.json/)).toBeInTheDocument();
  });
});

describe('the hand-over button: busy', () => {
  it('is amber, its LABEL says what it interrupts (not the colour alone), and a click lists the reasons and sends nothing', async () => {
    const { calls } = stubFetch({ ...LIST, [SWITCH]: switched('hc') });
    bar({ adoptReadiness: BUSY });
    await screen.findByLabelText('Permission mode');
    expect(wrapper()).toHaveTextContent('Hand over to Terminal (interrupts 2 running items)');
    expect(wrapper()).toHaveAttribute('data-readiness', 'busy');
    expect(button().querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    await userEvent.click(button());
    const dialog = screen.getByRole('dialog', { name: 'Hand over to Terminal while something runs?' });
    for (const reason of BUSY.reasons) {
      // The words of the daemon are shown as a sentence: no backticks.
      expect(within(dialog).getByText(prose(reason))).toBeInTheDocument();
    }
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('after the confirmation it sends force: true, once', async () => {
    const { calls } = stubFetch({ ...LIST, [SWITCH]: switched('hc') });
    const { onChange } = bar({ adoptReadiness: BUSY });
    await screen.findByLabelText('Permission mode');
    await userEvent.click(button());
    await userEvent.click(screen.getByRole('button', { name: 'Hand over anyway' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const posts = calls.filter((call) => call.method === 'POST' && call.path === `/owned/${ID}/switch`);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.body).toEqual({ target: 'hc', force: true });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a failure after the confirmation stays in the dialog with the daemon text and the command to resume by hand', async () => {
    stubFetch({ ...LIST, [SWITCH]: { status: 422, body: { ok: false, error: { code: 'switch-target-failed', message: 'The session was stopped on stream-json but could not be started on hc', hint: 'Resume it by hand: cd "/work" and run: claude --resume 1111' } } } });
    const { onChange } = bar({ adoptReadiness: BUSY });
    await screen.findByLabelText('Permission mode');
    await userEvent.click(button());
    await userEvent.click(screen.getByRole('button', { name: 'Hand over anyway' }));
    expect(await screen.findByText(/could not be started on hc.*Resume it by hand/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('the hand-over button: unknown', () => {
  it('is amber as well (never free), says it cannot tell, and asks for the confirmation', async () => {
    stubFetch({ ...LIST, [SWITCH]: switched('hc') });
    bar({ adoptReadiness: UNKNOWN });
    await screen.findByLabelText('Permission mode');
    expect(wrapper()).toHaveTextContent('Hand over to Terminal (cannot tell what runs)');
    expect(wrapper()).toHaveAttribute('data-readiness', 'unknown');
    await userEvent.click(button());
    const dialog = screen.getByRole('dialog', { name: 'Hand over to Terminal without knowing what runs?' });
    expect(within(dialog).getByText(UNKNOWN.reasons[0] as string)).toBeInTheDocument();
  });
});

describe('the server recomputes: its answer wins over the colour of the page', () => {
  it('a button that said free opens the dialog with the reasons the daemon found, and sends force only after the confirmation', async () => {
    let attempts = 0;
    const { calls } = stubFetch({
      ...LIST,
      [SWITCH]: () => {
        attempts += 1;
        return attempts === 1
          ? { status: 409, body: { ok: false, error: { code: 'switch-not-ready', message: 'The session is not free to move to hc: A turn is running: its partial answer is lost', hint: 'Wait for it to finish, or confirm these items and send the switch again with force' } } }
          : switched('hc');
      },
    });
    const { onChange } = bar({ adoptReadiness: FREE });
    await screen.findByLabelText('Permission mode');
    await userEvent.click(button());
    const dialog = await screen.findByRole('dialog', { name: 'Hand over to Terminal while something runs?' });
    expect(dialog).toHaveTextContent('A turn is running: its partial answer is lost');
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Hand over anyway' }));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(calls.filter((call) => call.method === 'POST' && call.path === `/owned/${ID}/switch`).map((call) => call.body)).toEqual([
      { target: 'hc', force: false },
      { target: 'hc', force: true },
    ]);
  });

  it('any other refusal of a free click is shown under the buttons with its hint, and nothing moves', async () => {
    stubFetch({ ...LIST, [SWITCH]: { status: 422, body: { ok: false, error: { code: 'switch-untrusted-folder', message: 'The folder is not trusted by Claude Code', hint: 'Trust it once, then switch again (nothing was stopped)' } } } });
    const { onChange } = bar({ adoptReadiness: FREE });
    await screen.findByLabelText('Permission mode');
    await userEvent.click(button());
    expect(await screen.findByText(/not trusted by Claude Code.*nothing was stopped/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('the hand-over button on a terminal session', () => {
  it('hands it over to Web', async () => {
    const { calls } = stubFetch({ [SWITCH]: switched('stream-json') });
    const { onChange } = bar({ host: 'hc', ownedState: 'unobserved', alive: true, adoptReadiness: FREE });
    expect(wrapper()).toHaveTextContent('Hand over to Web');
    await userEvent.click(button());
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(calls.find((call) => call.method === 'POST')?.body).toEqual({ target: 'stream-json', force: false });
    expect(await screen.findByText(/now runs as a Web session/)).toBeInTheDocument();
  });

  it('is not offered for an ended session, a background session or a discovered one', () => {
    stubFetch({ ...LIST });
    for (const overrides of [{ ownedState: 'exited' as const, alive: false }, { host: 'bg' as const }, { launchedBy: 'discovered' as const, host: null, ownedState: undefined }]) {
      const { unmount } = render(<OwnedBar session={ownedRow({ sessionId: ID, adoptReadiness: FREE, ...overrides })} onChange={vi.fn()} onForgotten={vi.fn()} />);
      expect(document.querySelector('[data-adopt-button]')).toBeNull();
      unmount();
    }
  });
});

describe('the Start button after a failed hand-over', () => {
  const FAILURE = { at: 1, target: 'hc' as const, reason: 'hc run refused (busy)' };

  it('a stopped hc record shows the failure and a "Start on Web" button that sends the same switch route, without force', async () => {
    const { calls } = stubFetch({ [SWITCH]: switched('stream-json') });
    const { onChange } = bar({ host: 'hc', ownedState: 'unobserved', alive: false, switchFailure: { ...FAILURE, target: 'stream-json' } });
    expect(wrapper()).toHaveTextContent('Start on Web');
    expect(screen.getAllByText(/The last hand-over to Web failed/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/hc run refused \(busy\)/).length).toBeGreaterThan(0);
    await userEvent.click(button());
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ kind: 'updated', session: expect.objectContaining({ id: ID, hostKind: 'stream-json' }) }));
    expect(calls.find((call) => call.method === 'POST' && call.path === `/owned/${ID}/switch`)?.body).toEqual({ target: 'stream-json', force: false });
  });

  it('a refusal of the start (another process holds the session) is written under the buttons with its hint', async () => {
    stubFetch({ ...LIST, [SWITCH]: { status: 409, body: { ok: false, error: { code: 'session-held', message: 'the session is held by another live process: pid 7777', hint: 'end that process, then switch again' } } } });
    bar({ host: 'stream-json', ownedState: 'exited', alive: false, switchFailure: FAILURE });
    await userEvent.click(button());
    expect(await screen.findByText(/held by another live process: pid 7777/)).toBeInTheDocument();
  });
});

describe('a draft in the terminal', () => {
  it('opens the confirmation with the server words (the page could not know), and force is sent only after it', async () => {
    let attempts = 0;
    const { calls } = stubFetch({
      ...LIST,
      [SWITCH]: () => {
        attempts += 1;
        return attempts === 1
          ? { status: 409, body: { ok: false, error: { code: 'switch-draft', message: 'the terminal t7 has text typed in its prompt (half typed): ending claude would lose it', hint: 'clear the draft or force: the draft will be lost' } } }
          : switched('stream-json');
      },
    });
    bar({ adoptReadiness: FREE });
    await screen.findByLabelText('Permission mode');
    await userEvent.click(button());
    expect(await screen.findByRole('dialog')).toHaveTextContent(/half typed/);
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Hand over anyway' }));
    await waitFor(() => expect(calls.filter((call) => call.method === 'POST')).toHaveLength(2));
    expect(calls.filter((call) => call.method === 'POST')[1]?.body).toMatchObject({ force: true });
  });
});

describe('the hand-over icon of the one-line header: plain, structured tooltip, state in a part of the glyph', () => {
  function compactBar(adoptReadiness: AdoptReadinessDto, look: SwitchReadinessVariant = 'corner') {
    return render(
      <UiVariantsContext.Provider value={{ ...DEFAULT_UI_VARIANTS, switchReadiness: look }}>
        <OwnedBar session={ownedRow({ sessionId: ID, adoptReadiness })} onChange={vi.fn()} onForgotten={vi.fn()} inline={{ slot: document.body }} />
      </UiVariantsContext.Provider>,
    );
  }

  it('the tooltip lists one row per kind of thing that is interrupted with its count, never the whole reasons, and says a click shows the details', async () => {
    stubFetch({ ...LIST });
    compactBar(BUSY);
    await screen.findByLabelText('Permission mode');
    hoverTip(button());
    const text = liveTooltip().textContent ?? '';
    expect(text).toContain('Tools and background tasks');
    expect(text).toContain('Queued messages');
    expect(text).toContain('click to review what it interrupts');
    // The whole sentences (and their backticks) are for the confirmation of the hand-over button.
    expect(text).not.toContain('node wait.mjs');
    expect(text).not.toContain('`');
    expect(text.length).toBeLessThan(200);
  });

  it('is a plain ghost icon: no text, no pill, no coloured tint, and the name says the state in words', async () => {
    for (const [readiness, words] of [
      [FREE, 'Hand over to Terminal: nothing is running'],
      [BUSY, 'Hand over to Terminal (interrupts 2 running items)'],
      [UNKNOWN, 'Hand over to Terminal (cannot tell what runs)'],
    ] as const) {
      stubFetch({ ...LIST });
      const { unmount } = render(
        <UiVariantsContext.Provider value={{ ...DEFAULT_UI_VARIANTS }}>
          <OwnedBar session={ownedRow({ sessionId: ID, adoptReadiness: readiness })} onChange={vi.fn()} onForgotten={vi.fn()} inline={{ slot: document.body }} />
        </UiVariantsContext.Provider>,
      );
      await screen.findByLabelText('Permission mode');
      const found = screen.getByRole('button', { name: words });
      expect(found.textContent).toBe('');
      expect(found.closest('[data-adopt-button]')?.innerHTML).not.toMatch(/hue-green|bg-warning|text-warning|rounded-full border/);
      unmount();
    }
  });

  it('a click on a busy session still asks for the confirmation first, whatever the look', async () => {
    for (const look of ['corner', 'dashed', 'faded', 'filled', 'bar'] as const) {
      const { calls } = stubFetch({ ...LIST });
      const { unmount } = compactBar(BUSY, look);
      await screen.findByLabelText('Permission mode');
      await userEvent.click(button());
      expect(screen.getByRole('dialog', { name: 'Hand over to Terminal while something runs?' })).toBeInTheDocument();
      expect(calls.some((call) => call.method === 'POST')).toBe(false);
      await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
      unmount();
    }
  });
});
