import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogEntry } from '../deps.js';
import { row } from '../deps.js';
import { resetPending } from '../pending.js';
import { answer } from './entryFixtures.js';
import { LogViewer } from './LogViewer.js';

const session = row({ displayName: 'owner' });

function serveEntries(entries: LogEntry[]): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => answer(entries) }) as unknown as Response));
}

beforeEach(() => {
  resetPending();
  Element.prototype.scrollIntoView = vi.fn();
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0)) as typeof window.requestAnimationFrame;
});
afterEach(() => vi.unstubAllGlobals());

const base = { offset: 0, timestamp: 1_000 };
const ref = (id: string, displayName: string) => ({ id, displayName });

describe('model entries and unknown kinds', () => {
  it('a model change is a visible notice "Model changed: A -> B"', async () => {
    serveEntries([{ key: 'm1', ...base, kind: 'model-change', from: ref('a', 'Sonnet 4.6'), to: ref('b', 'Haiku 5.5'), source: 'command', text: 'Model changed: Sonnet 4.6 -> Haiku 5.5' } as unknown as LogEntry]);
    render(<LogViewer session={session} />);
    expect(await screen.findByText('Model changed: Sonnet 4.6 -> Haiku 5.5')).toBeInTheDocument();
  });

  it('model-info is a quiet but visible row with the model name', async () => {
    serveEntries([{ key: 'm2', ...base, kind: 'model-info', modelId: 'us.anthropic.claude-opus-5-5[1m]', displayName: 'Opus 5.5 (1M context)' } as unknown as LogEntry]);
    render(<LogViewer session={session} />);
    expect(await screen.findByText('Opus 5.5 (1M context)')).toBeInTheDocument();
  });

  it('an entry kind the page does not know is shown with its kind name, never dropped', async () => {
    serveEntries([{ key: 'z1', ...base, kind: 'brand-new-kind' } as unknown as LogEntry]);
    render(<LogViewer session={session} />);
    expect(await screen.findByText(/kind "brand-new-kind": this page does not know how to show it/)).toBeInTheDocument();
  });
});
