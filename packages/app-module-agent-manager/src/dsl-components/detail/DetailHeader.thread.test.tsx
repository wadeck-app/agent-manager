import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ownedRow } from '../logic/fixtures.js';
import { stubFetch } from '../owned/testFetch.js';
import { DetailHeader } from './DetailHeader.js';

afterEach(() => vi.unstubAllGlobals());

const SOURCE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const THREAD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ANCHOR = '27bf9648-39df-453b-bd04-99816f5c1819';

function header(session: ReturnType<typeof ownedRow>, extra: Partial<Parameters<typeof DetailHeader>[0]> = {}) {
  return <DetailHeader session={session} now={2_000_000} busy={false} onBack={() => undefined} onTogglePin={() => undefined} onMarkSeen={() => undefined} onOwnedChange={() => undefined} onForgotten={() => undefined} onForked={() => undefined} onOpenSource={() => undefined} {...extra} />;
}

describe('the chip of a thread in the detail header', () => {
  it('reads "thread of <name> at <quote>" (the quote comes from the daemon record) and the link goes back to the anchor row of the source', async () => {
    stubFetch({ 'GET /owned': { body: { ok: true, generatedAt: 'now', daemon: {}, sessions: [] } } });
    const onLocateAnchor = vi.fn();
    render(header(ownedRow({ sessionId: THREAD, forkedFrom: SOURCE, threadOf: { sessionId: SOURCE, messageId: ANCHOR, quote: 'why is it red?' } }), { forkedFrom: { id: SOURCE, name: 'shop' }, onLocateAnchor }));
    const chip = document.querySelector('[data-thread-of]') as HTMLElement;
    expect(chip.textContent).toBe('thread of shop at "why is it red?"');
    await userEvent.click(screen.getByRole('button', { name: /Go to the message/ }));
    expect(onLocateAnchor).toHaveBeenCalledWith(SOURCE, ANCHOR);
    // The thread is a thread: the plain "forked from" line is not shown twice.
    expect(document.querySelector('[data-forked-from]')).toBeNull();
  });

  it('a thread without a recorded quote shows the short message id', () => {
    stubFetch({ 'GET /owned': { body: { ok: true, generatedAt: 'now', daemon: {}, sessions: [] } } });
    render(header(ownedRow({ sessionId: THREAD, forkedFrom: SOURCE, threadOf: { sessionId: SOURCE, messageId: ANCHOR } }), { forkedFrom: { id: SOURCE, name: 'shop' } }));
    expect((document.querySelector('[data-thread-of]') as HTMLElement).textContent).toBe('thread of shop at message 27bf9648');
  });

  it('keeps the link when the source row is not in the list (filtered out or ended): the id is known, the page then says why it is not shown', async () => {
    stubFetch({ 'GET /owned': { body: { ok: true, generatedAt: 'now', daemon: {}, sessions: [] } } });
    const onLocateAnchor = vi.fn();
    render(header(ownedRow({ sessionId: THREAD, forkedFrom: SOURCE, threadOf: { sessionId: SOURCE, messageId: ANCHOR } }), { forkedFrom: { id: SOURCE, name: undefined }, onLocateAnchor }));
    const chip = document.querySelector('[data-thread-of]') as HTMLElement;
    expect(chip.textContent).toBe('thread of an agent that is not in the list at message 27bf9648');
    await userEvent.click(screen.getByRole('button', { name: /Go to the message/ }));
    expect(onLocateAnchor).toHaveBeenCalledWith(SOURCE, ANCHOR);
  });

  it('a plain fork keeps its "forked from" line and has no chip', () => {
    stubFetch({});
    render(header(ownedRow({ sessionId: THREAD, forkedFrom: SOURCE }), { forkedFrom: { id: SOURCE, name: 'shop' } }));
    expect(document.querySelector('[data-thread-of]')).toBeNull();
    expect(document.querySelector('[data-forked-from]')).not.toBeNull();
  });
});
