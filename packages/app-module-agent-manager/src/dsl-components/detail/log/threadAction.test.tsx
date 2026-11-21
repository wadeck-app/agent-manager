import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogResponse } from '../deps.js';
import { row } from '../deps.js';
// violations-suppress: ts/no-deep-relative test helper of the module, not exported through deps.ts (it imports vitest)
import { ownedDto } from '../../logic/fixtures.js';
// violations-suppress: ts/no-deep-relative test helper of the module, not exported through deps.ts (it imports vitest)
import { stubFetch } from '../../owned/testFetch.js';
import { resetPending } from '../pending.js';
import { answer, assistantText, toolCall, userPrompt } from './entryFixtures.js';
import { LogViewer } from './LogViewer.js';

const SOURCE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const U1 = '11111111-0000-4000-8000-000000000001';
const A1 = '11111111-0000-4000-8000-000000000002';
const session = row({ sessionId: SOURCE, displayName: 'shop-owner' });

const withUuid = <T extends object>(entry: T, uuid: string): T => ({ ...entry, uuid });

/** The log route has the session id in its path: the router of stubFetch matches exact paths, so the test registers the one of the session. */
function stubLog(entries: unknown[], extra: Record<string, { status?: number; body: unknown }> = {}) {
  return stubFetch({ [`GET /sessions/${SOURCE}/log`]: { body: answer(entries as never) as LogResponse }, ...extra });
}

beforeEach(() => {
  resetPending();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.unstubAllGlobals());

describe('the Thread action of the log rows', () => {
  it('is on each user and assistant message that has a uuid, and on nothing else (a tool call has none)', async () => {
    stubLog([withUuid(userPrompt('u', 'run the tests'), U1), withUuid(assistantText('a', 'all green'), A1), toolCall('t1', { status: 'ok' })]);
    render(<LogViewer session={session} onThreadStarted={() => undefined} />);
    await screen.findByText('run the tests');
    expect(screen.getAllByRole('button', { name: 'Thread' })).toHaveLength(2);
  });

  it('a message without uuid shows a disabled button that says why (never a missing control without explanation)', async () => {
    stubLog([userPrompt('u', 'old line without uuid')]);
    render(<LogViewer session={session} onThreadStarted={() => undefined} />);
    await screen.findByText('old line without uuid');
    const button = screen.getByRole('button', { name: 'Thread' });
    expect(button).toBeDisabled();
    await userEvent.hover(button.parentElement as HTMLElement);
    expect(await screen.findByText(/no uuid/)).toBeInTheDocument();
  });

  it('opens the compact dialog on that message, starts the thread and reports it to the page', async () => {
    const { calls } = stubLog([withUuid(userPrompt('u', 'run the tests'), U1), withUuid(assistantText('a', 'all green'), A1)], {
      'POST /owned/fork': { body: { ok: true, session: ownedDto({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', forkedFrom: SOURCE, forkedAtMessage: A1 }) } },
    });
    const onThreadStarted = vi.fn();
    render(<LogViewer session={session} onThreadStarted={onThreadStarted} />);
    await screen.findByText('all green');
    // The second Thread button belongs to the assistant message.
    await userEvent.click(screen.getAllByRole('button', { name: 'Thread' })[1]!);
    const dialog = screen.getByRole('dialog', { name: 'Thread on shop-owner' });
    expect(within(dialog).getByLabelText('Name')).toHaveValue('thread: all green');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Start thread' }));
    await waitFor(() => expect(onThreadStarted).toHaveBeenCalledTimes(1));
    expect(calls.find((call) => call.path === '/owned/fork')?.body).toMatchObject({ sourceSessionId: SOURCE, atMessageId: A1, name: 'thread: all green' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('focusing an anchor row (the link back from a thread)', () => {
  it('scrolls to the row of the message and pulses it', async () => {
    stubLog([withUuid(userPrompt('u', 'first'), U1), withUuid(assistantText('a', 'second'), A1)]);
    render(<LogViewer session={session} focusMessageId={A1} />);
    await screen.findByText('second');
    await waitFor(() => expect(document.querySelector('[data-hot="true"]')).not.toBeNull());
    expect(document.querySelector('[data-hot="true"]')?.textContent).toContain('second');
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
  });

  it('says so when the message is not in the log (transcript rewritten, or beyond the pages searched), never nothing', async () => {
    stubLog([withUuid(userPrompt('u', 'first'), U1)]);
    render(<LogViewer session={session} focusMessageId="99999999-9999-4999-8999-999999999999" />);
    expect(await screen.findByText(/The message this thread was started from is not in the log/)).toBeInTheDocument();
    expect(document.querySelector('[data-hot="true"]')).toBeNull();
  });
});
