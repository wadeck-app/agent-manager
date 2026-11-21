import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogEntry } from '../deps.js';
import { row } from '../deps.js';
// violations-suppress: ts/no-deep-relative test helper of the module, not exported through deps.ts (it imports vitest)
import { stubFetch } from '../../owned/testFetch.js';
import { resetPending } from '../pending.js';
import { answer, userPrompt } from './entryFixtures.js';
import { LogViewer } from './LogViewer.js';

// The search of the anchor row (link back from a thread): stops at the page that holds it, and tells apart "not there", "search limit" and "error".
// The page bound is lowered to 3 for this file only.
vi.mock('./sizes.js', async (original) => ({ ...(await original<typeof import('./sizes.js')>()), LOCATE_MAX_PAGES: 3 }));

const SOURCE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ANCHOR = '27bf9648-39df-453b-bd04-99816f5c1819';
const session = row({ sessionId: SOURCE, displayName: 'shop-owner' });

const at = (offset: number, text: string, uuid: string): LogEntry => ({ ...userPrompt(`k${offset}`, text), offset, uuid });

let beforeCalls: string[];
beforeEach(() => {
  beforeCalls = [];
  Element.prototype.scrollIntoView = vi.fn();
  resetPending();
});
afterEach(() => vi.unstubAllGlobals());

/** Serves the log in pages: the tail, then `older[i]` for `before=o<i+1>`; a page with `fail` answers an error. */
function serve(older: { entries: LogEntry[]; fail?: boolean }[]) {
  return stubFetch({
    [`GET /sessions/${SOURCE}/log`]: (call) => {
      const params = new URLSearchParams(call.query);
      const before = params.get('before');
      if (before === null) {
        return { body: params.get('after') === null ? answer([at(1000, 'recent', 'u-recent')], { olderCursor: older.length > 0 ? 'o1' : null }) : answer([], { olderCursor: null }) };
      }
      beforeCalls.push(before);
      const index = Number(before.slice(1)) - 1;
      const page = older[index];
      if (page === undefined) {
        return { status: 500, body: { ok: false, error: { code: 'test', message: `unexpected request for ${before}`, hint: 'the search went too far' } } };
      }
      if (page.fail === true) {
        return { status: 500, body: { ok: false, error: { code: 'transcript-unreadable', message: 'The transcript cannot be read.', hint: 'Close the program that locks it.' } } };
      }
      return { body: answer(page.entries, { olderCursor: index + 1 < older.length ? `o${index + 2}` : null }) };
    },
  });
}

describe('searching the anchor row of a thread', () => {
  it('stops at the page that holds the message: the pages behind it are never requested', async () => {
    serve([{ entries: [at(500, 'middle', 'u-mid')] }, { entries: [at(100, 'the anchor message', ANCHOR)] }, { entries: [at(10, 'older still', 'u-old')] }, { entries: [at(1, 'oldest', 'u-oldest')] }]);
    render(<LogViewer session={session} focusMessageId={ANCHOR} />);
    await waitFor(() => expect(document.querySelector('[data-hot="true"]')).not.toBeNull());
    expect(document.querySelector('[data-hot="true"]')?.textContent).toContain('the anchor message');
    expect(beforeCalls).toEqual(['o1', 'o2']);
  });

  it('says "not in the log" only when the whole transcript was searched', async () => {
    serve([{ entries: [at(500, 'middle', 'u-mid')] }]);
    render(<LogViewer session={session} focusMessageId={ANCHOR} />);
    expect(await screen.findByText(/is not in the log/)).toBeInTheDocument();
    expect(beforeCalls).toEqual(['o1']);
  });

  it('a failing page shows its message and hint, not "not in the log"', async () => {
    serve([{ entries: [], fail: true }]);
    render(<LogViewer session={session} focusMessageId={ANCHOR} />);
    expect((await screen.findAllByText(/The transcript cannot be read/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Close the program that locks it/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/is not in the log/)).toBeNull();
  });

  it('at the page limit it says the limit was reached and how to continue, not "not in the log"', async () => {
    serve([{ entries: [at(500, 'p1', 'u1')] }, { entries: [at(400, 'p2', 'u2')] }, { entries: [at(300, 'p3', 'u3')] }, { entries: [at(100, 'the anchor message', ANCHOR)] }]);
    render(<LogViewer session={session} focusMessageId={ANCHOR} />);
    expect(await screen.findByText(/search stopped after 3 pages.*Load older entries/s)).toBeInTheDocument();
    expect(screen.queryByText(/is not in the log/)).toBeNull();
    expect(beforeCalls).toEqual(['o1', 'o2', 'o3']);
  });
});
