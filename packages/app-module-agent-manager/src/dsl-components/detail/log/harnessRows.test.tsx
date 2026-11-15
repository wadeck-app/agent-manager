import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogEntry } from '../deps.js';
import { row } from '../deps.js';
import { resetPending } from '../pending.js';
import { answer, userPrompt } from './entryFixtures.js';
import { LogViewer } from './LogViewer.js';

const session = row({ displayName: 'claude-plugin-owner' });

function serveEntries(entries: LogEntry[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => answer(entries) }) as unknown as Response),
  );
}

beforeEach(() => {
  resetPending();
  Element.prototype.scrollIntoView = vi.fn();
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0)) as typeof window.requestAnimationFrame;
});
afterEach(() => vi.unstubAllGlobals());

// The shapes of a real session after /compact (trimmed): the server flags them (`harness`) and strips the ANSI escapes.
const command: LogEntry = { ...userPrompt('u1', '<command-name>/compact</command-name><command-message>compact</command-message><command-args></command-args>'), harness: { label: 'Command /compact', summary: '/compact', detail: '', tags: ['command-name', 'command-message', 'command-args'] } } as LogEntry;
const output: LogEntry = { ...userPrompt('u2', '<local-command-stdout>Compacted (ctrl+o to see full summary)</local-command-stdout>'), harness: { label: 'Command output', summary: 'Compacted (ctrl+o to see full summary)', detail: 'Compacted (ctrl+o to see full summary)', tags: ['local-command-stdout'] } } as LogEntry;
const withArgs: LogEntry = { ...userPrompt('u3', '<command-name>/model</command-name><command-args>sonnet extra words</command-args>'), harness: { label: 'Command /model', summary: '/model sonnet extra words', detail: 'sonnet extra words', tags: ['command-name', 'command-args'] } } as LogEntry;

describe('text Claude Code injected itself', () => {
  it('shows a readable label, collapsed, instead of a raw "You" bubble with tags', async () => {
    serveEntries([command, output, userPrompt('u4', 'Please go on')]);
    render(<LogViewer session={session} />);
    expect(await screen.findByText('Command /compact')).toBeInTheDocument();
    expect(screen.getByText('Command output')).toBeInTheDocument();
    expect(screen.queryByText(/<command-name>/)).toBeNull();
    expect(screen.queryByText(/<local-command-stdout>/)).toBeNull();
    // The genuine prompt stays a bubble of the person.
    expect(screen.getByText('Please go on')).toBeInTheDocument();
    expect(screen.getAllByText('You')).toHaveLength(1);
  });

  it('an entry with arguments expands to show them', async () => {
    serveEntries([withArgs]);
    render(<LogViewer session={session} />);
    const header = await screen.findByText('Command /model');
    expect(screen.queryAllByText('sonnet extra words')).toHaveLength(0);
    fireEvent.click(header);
    expect(screen.getByText('sonnet extra words')).toBeInTheDocument();
  });

  it('text with an unknown tag is a normal prompt, shown as written', async () => {
    serveEntries([userPrompt('u5', '<hc from="t1c">Run exactly this</hc>')]);
    render(<LogViewer session={session} />);
    expect(await screen.findByText('<hc from="t1c">Run exactly this</hc>')).toBeInTheDocument();
  });
});
