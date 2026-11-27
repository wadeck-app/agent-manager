import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../deps.js';
import { toolCall, userPrompt } from './entryFixtures.js';
import { ChatFrame } from './ChatFrame.js';
import { buildRows } from './grouping.js';
import { describeEntry, describeRow } from './rowModel.js';

type Notice = Extract<LogEntry, { kind: 'system-notice' }>;
type Hook = Extract<LogEntry, { kind: 'hook' }>;

const notice = (patch: Partial<Notice>): LogEntry => ({ key: 'n', offset: 0, timestamp: 5_000, kind: 'system-notice', noticeKind: 'other', subtype: 'x', isMeta: false, ...patch });
const hook = (patch: Partial<Hook> = {}): LogEntry => ({ key: 'h', offset: 0, timestamp: 4_000, kind: 'hook', hookEvent: 'Stop', hookName: 'Stop', outcome: 'success', attachmentType: 'hook_success', ...patch });
const thinking = (text: string, patch: Partial<Extract<LogEntry, { kind: 'thinking' }>> = {}): LogEntry => ({ key: 't', offset: 0, kind: 'thinking', collapsible: true, text, textTruncated: false, textBytes: text.length, ...patch });
const NO_CONTEXT = { isOpen: () => false, toggle: () => undefined };

describe('which rows open: a row opens only when its body says more than its line', () => {
  it('a turn duration that only repeats its header does not open; a stop-hook without text does not open', () => {
    expect(describeEntry(notice({ noticeKind: 'turn-duration', subtype: 'turn_duration', durationMs: 43_000 })).expandable).toBe(false);
    const stop = describeEntry(notice({ noticeKind: 'stop-hook', subtype: 'stop_hook_summary', hookCount: 1 }));
    expect(stop.expandable).toBe(false);
    expect(stop.body).toBeNull();
  });

  it('a notice with a second line, or with a line cut in its summary, opens', () => {
    expect(describeEntry(notice({ text: 'first line\nsecond line' })).expandable).toBe(true);
    expect(describeEntry(notice({ text: 'x'.repeat(300) })).expandable).toBe(true);
    expect(describeEntry(notice({ text: 'Conversation compacted' })).expandable).toBe(false);
  });

  it('a hook opens when it has a command, an exit code, an output or an error text; a bare hook does not', () => {
    expect(describeEntry(hook()).expandable).toBe(false);
    expect(describeEntry(hook({ output: 'lint passed' })).expandable).toBe(true);
    expect(describeEntry(hook({ outcome: 'error', stderr: 'boom' })).expandable).toBe(true);
    expect(describeEntry(hook({ command: 'node check.js' })).expandable).toBe(true);
    expect(describeEntry(hook({ exitCode: 2 })).expandable).toBe(true);
  });

  it('thinking opens when its text is longer than its line; no text, or a single short line, does not', () => {
    expect(describeEntry(thinking('one short thought')).expandable).toBe(false);
    expect(describeEntry(thinking('one\ntwo')).expandable).toBe(true);
    expect(describeEntry(thinking('x', { textTruncated: true })).expandable).toBe(true);
    const empty = describeEntry(thinking(''));
    expect(empty.expandable).toBe(false);
    expect(empty.summary).toContain('keeps no text');
  });

  it('a message of the harness (a peer, a task) opens only when it has more than one line, an image or a cut', () => {
    const peer = (patch: Record<string, unknown>): LogEntry => ({ ...userPrompt('p', 'hello'), source: 'task-notification', ...patch }) as LogEntry;
    expect(describeEntry(peer({})).expandable).toBe(false);
    expect(describeEntry(peer({ text: 'a\nb' })).expandable).toBe(true);
    expect(describeEntry(peer({ textTruncated: true })).expandable).toBe(true);
  });

  it('tool calls and groups of calls always open (the body holds the input and the state of the call)', () => {
    expect(describeEntry(toolCall('1', { status: 'running' })).expandable).toBe(true);
    const group = buildRows([toolCall('1'), toolCall('2')]);
    expect(describeRow(group[0]!).expandable).toBe(true);
  });

  it('the rows that never open (queue, model, usage) say it the same way', () => {
    expect(describeEntry({ key: 'q', offset: 0, kind: 'queue-operation', operation: 'dequeue' }).expandable).toBe(false);
  });
});

function frame(entry: LogEntry) {
  return render(<ChatFrame model={describeEntry(entry)} open={false} onToggle={() => undefined} context={NO_CONTEXT} now={5_000} highlighted={false} />);
}

describe('the expand chevron of a log row', () => {
  it('a row that opens has a button with the chevron and aria-expanded', () => {
    frame(thinking('one\ntwo'));
    const button = screen.getByRole('button', { name: /Thinking/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button.querySelector('[data-expand-mark="closed"]')).not.toBeNull();
  });

  it('a row with nothing to open keeps the chevron slot, faint, with no button, no tab stop and no click effect', async () => {
    const { container } = frame(notice({ noticeKind: 'turn-duration', subtype: 'turn_duration', durationMs: 43_000 }));
    expect(screen.queryByRole('button')).toBeNull();
    const mark = container.querySelector('[data-expand-mark="off"]');
    expect(mark).not.toBeNull();
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(mark).toHaveClass('opacity-30', 'cursor-default');
    expect(container.querySelector('[tabindex], [aria-expanded], button')).toBeNull();
    await userEvent.click(mark as Element);
    expect(screen.getByText('System: turn-duration')).toBeInTheDocument();
    expect(screen.getByText('took 43 s')).toBeInTheDocument();
  });

  it('a static row shows its whole summary (it wraps instead of being cut)', () => {
    frame(notice({ text: 'a single line that is all there is to say' }));
    expect(screen.getByText('a single line that is all there is to say')).toHaveClass('break-words');
    expect(screen.getByText('a single line that is all there is to say')).not.toHaveClass('truncate');
  });
});
