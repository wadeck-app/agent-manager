import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogResponse } from '../deps.js';
import { row } from '../deps.js';
import { addPending, getPending, resetPending } from '../pending.js';
import { answer, assistantText, toolCall, userPrompt } from './entryFixtures.js';
import { LogViewer } from './LogViewer.js';

const session = row({ displayName: 'shop-owner' });

function respond(body: LogResponse, status = 200): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response;
}

let queue: (() => Response)[];
let urls: string[];

beforeEach(() => {
  queue = [];
  urls = [];
  resetPending();
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      // The Permissions tab of the rail reads the guardrails files: answered apart, it must not take an answer queued for the log.
      if (url.includes('/guardrails/overview')) {
        return new Response(JSON.stringify({ ok: true, grants: [], sessions: [], problems: [], killSwitch: { active: false, path: '', errorText: '' } }), { status: 200 });
      }
      // The same for the bypasses of the session (the plugin admin CLI): here "not installed", so the panel falls back to the files.
      if (url.includes('/guardrails/sessions/')) {
        return new Response(JSON.stringify({ ok: false, code: 'not-installed', sessionId: 'x', cwd: '', cwdNote: '', grants: [], errorText: 'w-guardrails is not installed (looked in x). Install it.' }), { status: 200 });
      }
      urls.push(url);
      const next = queue.length > 1 ? queue.shift() : queue[0];
      if (next === undefined) {
        throw new Error('no answer queued for the test');
      }
      return next();
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('LogViewer', () => {
  it('carries the monospace log font class on the log container, not on the filter bar above it', async () => {
    queue = [() => respond(answer([userPrompt('u', 'hello'), assistantText('a', 'hi')]))];
    render(<LogViewer session={session} />);
    expect(await screen.findByText('hello')).toBeInTheDocument();
    const log = screen.getByRole('log');
    expect(log).toHaveClass('am-log-font');
    expect(document.querySelectorAll('.am-log-font')).toHaveLength(1);
  });

  it('shows the tail with tool calls collapsed, and opens one with the keyboard-reachable button', async () => {
    queue = [() => respond(answer([userPrompt('u', 'run the tests'), assistantText('a', 'Sure, **running** now'), toolCall('t1', { status: 'ok', resultPreview: 'all green', durationMs: 3200 })]))];
    render(<LogViewer session={session} />);
    expect(await screen.findByText('run the tests')).toBeInTheDocument();
    expect(screen.getByText('running').tagName).toBe('STRONG');
    const call = screen.getByRole('button', { name: /Bash/ });
    expect(call).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('all green')).toBeNull();
    fireEvent.click(call);
    expect(call).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('all green')).toBeInTheDocument();
  });

  it('groups consecutive tool calls under one collapsed line, and opens a call inside', async () => {
    queue = [() => respond(answer([toolCall('a', { status: 'ok', resultPreview: 'one' }), toolCall('b', { status: 'ok', name: 'Read', resultPreview: 'two' })]))];
    render(<LogViewer session={session} />);
    const group = await screen.findByRole('button', { name: /2 tool calls/ });
    expect(screen.queryByText('one')).toBeNull();
    fireEvent.click(group);
    // The group line has chips whose names mention Bash: the line of the call is the button whose name STARTS with it.
    fireEvent.click(screen.getByRole('button', { name: /^Bash/ }));
    expect(screen.getByText('one')).toBeInTheDocument();
  });

  it('shows an unknown entry as unrecognised with its type, never dropped', async () => {
    queue = [() => respond(answer([{ key: 'k', offset: 0, kind: 'unknown', lineType: 'weird-type', keys: ['a', 'b'], bytes: 10 }]))];
    render(<LogViewer session={session} />);
    expect(await screen.findByText(/weird-type/)).toBeInTheDocument();
    expect(screen.getByText('Unrecognised entry')).toBeInTheDocument();
  });

  it('shows a banner with the hint and Retry on an unreadable transcript and keeps the entries', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    queue = [
      () => respond(answer([userPrompt('u', 'first message')])),
      () => respond({ ok: false, error: { code: 'transcript-unreadable', message: 'The transcript cannot be read.', hint: 'Close the program that locks it.' } }),
    ];
    render(<LogViewer session={session} />);
    await screen.findByText('first message');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The transcript cannot be read. Close the program that locks it.');
    expect(screen.getByText('first message')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument();
  });

  it('reloads the tail once by itself on a stale cursor, then shows the banner', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const stale = (): Response => respond({ ok: false, error: { code: 'cursor-stale', message: 'The cursor does not fit.', hint: 'Reload the log.' } });
    queue = [() => respond(answer([userPrompt('u', 'old')])), stale, () => respond(answer([userPrompt('n', 'fresh')], { cursor: 'c9' })), stale];
    render(<LogViewer session={session} />);
    await screen.findByText('old');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    await screen.findByText('fresh');
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('The cursor does not fit.');
    expect(screen.getByText('fresh')).toBeInTheDocument();
    expect(urls.filter((url) => !url.includes('after=')).length).toBe(2);
  });

  it('polls with the cursor and updates a running call in place', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    queue = [
      () => respond(answer([toolCall('r')], { cursor: 'c1' })),
      () => respond(answer([toolCall('r', { status: 'ok', resultPreview: 'finished output' }), assistantText('x', 'next')], { cursor: 'c2' })),
    ];
    render(<LogViewer session={session} />);
    const call = await screen.findByRole('button', { name: /Bash/ });
    expect(screen.getByRole('img', { name: 'Running' })).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    await screen.findByText('next');
    expect(urls[1]).toContain('after=c1');
    expect(screen.getAllByRole('button', { name: /Bash/ })).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'Finished' })).toBeInTheDocument();
    expect(call.isConnected).toBe(true);
  });

  it('never re-asks at once when more is announced but the cursor did not move, and says so', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    queue = [() => respond(answer([userPrompt('u', 'first')], { cursor: 'c1' })), () => respond(answer([], { cursor: 'c1', more: true }))];
    render(<LogViewer session={session} />);
    await screen.findByText('first');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('did not advance');
    // First poll plus at most one more within the next poll interval: no loop with a delay of 0
    const before = urls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(urls.length).toBe(before);
  });

  it('loads older entries with the button and puts them in front', async () => {
    queue = [() => respond(answer([userPrompt('u2', 'newer')], { olderCursor: 'o1' })), () => respond(answer([userPrompt('u1', 'older')], { cursor: null, olderCursor: null }))];
    render(<LogViewer session={session} />);
    fireEvent.click(await screen.findByRole('button', { name: /Load older entries/ }));
    await screen.findByText('older');
    expect(urls[1]).toContain('before=o1');
    const texts = screen.getAllByText(/newer|older/).map((node) => node.textContent);
    expect(texts[0]).toBe('older');
    await waitFor(() => expect(screen.getByText('Start of the transcript')).toBeInTheDocument());
  });

  it('shows a sent message once, then reconciles it when the transcript echoes it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    queue = [() => respond(answer([userPrompt('u', 'earlier', 1)], { cursor: 'c1' })), () => respond(answer([userPrompt('echo', 'please continue', Date.now())], { cursor: 'c2' }))];
    render(<LogViewer session={session} />);
    await screen.findByText('earlier');
    act(() => addPending({ messageId: 'm1', sessionId: session.sessionId, text: 'please continue', imageCount: 0, sentAt: Date.now(), state: 'delivered' }));
    expect(screen.getAllByText('please continue')).toHaveLength(1);
    expect(screen.getByRole('img', { name: /^Delivered: Sent to the session; waiting/ })).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    await waitFor(() => expect(getPending(session.sessionId)).toHaveLength(0));
    expect(screen.getAllByText('please continue')).toHaveLength(1);
    expect(screen.queryByRole('img', { name: /^Delivered: Sent to the session/ })).toBeNull();
  });

  it('shows a failed send with its error and keeps it', async () => {
    queue = [() => respond(answer([userPrompt('u', 'x', 1)]))];
    render(<LogViewer session={session} />);
    await screen.findByText('x');
    act(() => addPending({ messageId: 'm9', sessionId: session.sessionId, text: 'lost', imageCount: 0, sentAt: Date.now(), state: 'failed', error: 'Transport unavailable. Start the session with the socket.' }));
    expect(screen.getByRole('img', { name: /^Problem: Transport unavailable/ })).toBeInTheDocument();
    expect(screen.getAllByText(/Transport unavailable/).length).toBeGreaterThan(0);
  });

  it('shows the server note for a session without a transcript', async () => {
    queue = [() => respond(answer([], { note: 'No transcript yet for this session.' }))];
    render(<LogViewer session={session} />);
    expect(await screen.findByText('No transcript yet for this session.')).toBeInTheDocument();
  });

  it.each([
    [1, '1 entry was shortened by the server.'],
    [3, '3 entries were shortened by the server.'],
  ])('words %i shortened entries in the right number', async (fieldsCut, text) => {
    queue = [() => respond(answer([userPrompt('u', 'hello')], { truncated: { fieldsCut, bodyCapped: false, unreadableLines: 0 } }))];
    render(<LogViewer session={session} />);
    expect(await screen.findByText(text)).toBeInTheDocument();
  });
});
