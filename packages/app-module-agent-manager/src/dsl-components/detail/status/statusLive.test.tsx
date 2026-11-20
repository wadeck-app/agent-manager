import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { row } from '../deps.js';
import { DetailHeader } from '../DetailHeader.js';
import { LogViewer } from '../log/LogViewer.js';
import { resetPending } from '../pending.js';
import { answer, assistantText } from '../log/entryFixtures.js';
import { resetPublishedStatus } from './useSessionStatus.js';

const session = row({ displayName: 'billing-owner' });

beforeEach(() => {
  resetPending();
  resetPublishedStatus();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetPublishedStatus();
});

describe('the header follows the log poll', () => {
  it('shows the model of the first log answer, and the new one after a /model change on the next poll', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        const model = call < 2 ? { id: 'claude-opus-5-5', displayName: 'Opus 5.5', known: true } : { id: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5', known: true };
        const body = { ...answer([assistantText('a', 'hello')], { cursor: `c${call}` }), status: { model } };
        return { ok: true, status: 200, json: async () => body } as unknown as Response;
      }),
    );
    render(
      <>
        <DetailHeader session={session} now={2_000_000} busy={false} onBack={() => undefined} onTogglePin={() => undefined} onMarkSeen={() => undefined} onOwnedChange={() => undefined} onForgotten={() => undefined} />
        <LogViewer session={session} />
      </>,
    );
    expect(await screen.findByLabelText('Model Opus 5.5')).toBeInTheDocument();
    // The next poll (2 s) carries the new model: the header changes without a reload.
    await waitFor(() => expect(screen.getByLabelText('Model Sonnet 5.5')).toBeInTheDocument(), { timeout: 4000 });
    expect(screen.queryByLabelText('Model Opus 5.5')).toBeNull();
  });

  it('a log answer without status keeps the last live one (no flicker back to the row)', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        const base = answer([assistantText('a', 'hello')], { cursor: `c${call}` });
        const body = call === 1 ? { ...base, status: { gitBranch: 'live-branch' } } : base;
        return { ok: true, status: 200, json: async () => body } as unknown as Response;
      }),
    );
    render(
      <>
        <DetailHeader session={session} now={2_000_000} busy={false} onBack={() => undefined} onTogglePin={() => undefined} onMarkSeen={() => undefined} onOwnedChange={() => undefined} onForgotten={() => undefined} />
        <LogViewer session={session} />
      </>,
    );
    expect(await screen.findByText('live-branch')).toBeInTheDocument();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 2300));
    });
    expect(screen.getByText('live-branch')).toBeInTheDocument();
  });
});
