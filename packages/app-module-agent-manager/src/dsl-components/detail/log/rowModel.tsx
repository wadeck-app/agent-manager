import { Bell, Bot, Brain, ChevronDown, ChevronRight, CircleHelp, Clock, Cpu, GitFork, Layers, ListOrdered, Terminal, TriangleAlert, User, Users, Wrench, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { LogEntry } from '../deps.js';
import type { PendingMessage } from '../pending.js';
import { firstLine, formatBytes, formatDuration } from './format.js';
import { summariseGroup, type Row, type ToolCall } from './grouping.js';
import { Markdown } from './markdown.js';
import { LOG_ICON, LOG_META, LOG_MONO } from './sizes.js';
import { ToolBody, durationText } from './ToolBody.js';
import { ToolStatusIcon } from './ToolStatusIcon.js';

/** What a row needs from its container to open nested lines (the calls of a group). */
export interface OpenContext {
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
}

/** Everything a style needs to draw a row: the three styles lay the same model out differently. */
export interface RowModel {
  key: string;
  /** user: right in chat; assistant: left bubble; tool and meta: plain lines; */
  role: 'user' | 'assistant' | 'tool' | 'meta';
  icon: LucideIcon;
  iconClass: string;
  label: string;
  /** One line (the compact style and every collapsed header). */
  summary: string;
  timestamp?: number;
  /** Status icon, duration, counts, at the end of the header. */
  trailing?: ReactNode;
  tone: 'normal' | 'muted' | 'error';
  /** Collapsed until clicked in every style (tool calls, thinking, notices). Messages are open in chat and timeline, closed in compact. */
  expandable: boolean;
  body: ((context: OpenContext) => ReactNode) | null;
  /** The id of the tool call, for the highlight of its sub-agent. */
  callId?: string;
  subagentId?: string;
}

function truncatedNote(truncated: boolean, bytes: number, shownChars: number): ReactNode {
  return truncated ? <p className={`${LOG_META} text-muted`}>Shortened: the message is {formatBytes(bytes)}, {shownChars} characters are shown.</p> : null;
}

function promptModel(entry: Extract<LogEntry, { kind: 'user-prompt' }>): RowModel {
  const base = { key: entry.key, tone: 'normal' as const, ...(entry.timestamp === undefined ? {} : { timestamp: entry.timestamp }) };
  const images = entry.images.length > 0 ? <p className={`${LOG_META} text-muted`}>{entry.images.length} image(s) attached, not shown.</p> : null;
  const body = (): ReactNode => (
    <div className="flex flex-col gap-1">
      <p className="whitespace-pre-wrap break-words text-sm">{entry.text}</p>
      {images}
      {truncatedNote(entry.textTruncated, entry.textBytes, entry.text.length)}
    </div>
  );
  if (entry.source === 'human' || entry.source === 'other') {
    return { ...base, role: 'user', icon: User, iconClass: 'text-primary', label: entry.queued ? 'You (queued)' : 'You', summary: firstLine(entry.text), expandable: false, body };
  }
  const label = entry.source === 'peer' ? `Message from ${entry.peer?.name ?? entry.peer?.from ?? 'another session'}` : entry.source === 'task-notification' ? 'Background task finished' : 'Added by the harness';
  const icon = entry.source === 'peer' ? Users : entry.source === 'task-notification' ? Bell : Cpu;
  return { ...base, tone: 'muted', role: 'meta', icon, iconClass: 'text-muted', label, summary: firstLine(entry.text), expandable: true, body };
}

function noticeModel(entry: Extract<LogEntry, { kind: 'system-notice' }>): RowModel {
  const parts = [entry.text, entry.durationMs === undefined ? undefined : `took ${formatDuration(entry.durationMs)}`, entry.hookErrorCount ? `${entry.hookErrorCount} hook error(s)` : undefined].filter((part): part is string => part !== undefined && part !== '');
  const text = parts.join(' - ');
  return {
    key: entry.key,
    role: 'meta',
    icon: entry.level === 'error' ? TriangleAlert : Terminal,
    iconClass: entry.level === 'error' ? 'text-hue-red' : 'text-muted',
    label: `System: ${entry.noticeKind === 'other' ? entry.subtype : entry.noticeKind}`,
    summary: firstLine(text),
    tone: entry.level === 'error' ? 'error' : 'muted',
    expandable: text.length > 0,
    body: text === '' ? null : () => <p className="whitespace-pre-wrap break-words text-sm">{text}</p>,
    ...(entry.timestamp === undefined ? {} : { timestamp: entry.timestamp }),
  };
}

export function describeEntry(entry: LogEntry): RowModel {
  const at = entry.timestamp === undefined ? {} : { timestamp: entry.timestamp };
  switch (entry.kind) {
    case 'user-prompt':
      return promptModel(entry);
    case 'assistant-text':
      return {
        key: entry.key,
        role: 'assistant',
        icon: Bot,
        iconClass: 'text-hue-purple',
        label: 'Claude',
        summary: firstLine(entry.text),
        tone: 'normal',
        expandable: false,
        ...at,
        body: () => (
          <div className="flex flex-col gap-1">
            <Markdown text={entry.text} />
            {truncatedNote(entry.textTruncated, entry.textBytes, entry.text.length)}
          </div>
        ),
      };
    case 'thinking':
      return {
        key: entry.key,
        role: 'meta',
        icon: Brain,
        iconClass: 'text-muted',
        label: 'Thinking',
        summary: firstLine(entry.text),
        tone: 'muted',
        expandable: true,
        ...at,
        ...(entry.durationMs === undefined ? {} : { trailing: <span className={`${LOG_META} text-muted`}>{formatDuration(entry.durationMs)}</span> }),
        body: () =>
          entry.text === '' ? (
            <p className={`${LOG_META} text-muted`}>The transcript keeps no text for this thinking block.</p>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="whitespace-pre-wrap break-words text-sm italic text-muted">{entry.text}</p>
              {truncatedNote(entry.textTruncated, entry.textBytes, entry.text.length)}
            </div>
          ),
      };
    case 'tool-call':
      return callModel(entry);
    case 'system-notice':
      return noticeModel(entry);
    case 'queue-operation': {
      const what = [entry.operation, entry.reason, entry.contentKind === undefined ? undefined : `(${entry.contentKind})`].filter(Boolean).join(' ');
      return { key: entry.key, role: 'meta', icon: ListOrdered, iconClass: 'text-muted', label: 'Queue', summary: `${what}${entry.contentPreview ? `: ${firstLine(entry.contentPreview, 100)}` : ''}`, tone: 'muted', expandable: false, body: null, ...at };
    }
    case 'fork-ref':
      return { key: entry.key, role: 'meta', icon: GitFork, iconClass: 'text-muted', label: 'Forked', summary: `from session ${entry.parentSessionId ?? 'unknown'}`, tone: 'muted', expandable: false, body: null, ...at };
    case 'usage':
      return { key: entry.key, role: 'meta', icon: Cpu, iconClass: 'text-muted', label: 'Token usage', summary: `${entry.contextEstimate} tokens of context`, tone: 'muted', expandable: false, body: null, ...at };
    case 'unknown':
    case 'unparsable':
    case 'oversize': {
      const detail =
        entry.kind === 'unknown'
          ? `type "${entry.lineType}", fields: ${entry.keys.join(', ')}`
          : entry.kind === 'unparsable'
            ? `not JSON (${entry.reason})`
            : `line of ${formatBytes(entry.bytes)} over the ${formatBytes(entry.limit)} limit${entry.lineType === undefined ? '' : `, type "${entry.lineType}"`}`;
      return { key: entry.key, role: 'meta', icon: CircleHelp, iconClass: 'text-muted', label: 'Unrecognised entry', summary: `${entry.kind}: ${detail}`, tone: 'muted', expandable: false, body: null, ...at };
    }
  }
}

function callModel(call: ToolCall): RowModel {
  const orphan = call.orphan === true;
  return {
    key: call.key,
    role: 'tool',
    icon: Wrench,
    iconClass: 'text-muted',
    label: orphan ? 'Tool result' : call.name,
    summary: orphan ? firstLine(call.resultPreview ?? '') : call.inputSummary,
    tone: call.status === 'error' ? 'error' : 'normal',
    expandable: true,
    callId: call.id,
    ...(call.subagentId === undefined ? {} : { subagentId: call.subagentId }),
    ...(call.startedAt === undefined && call.finishedAt === undefined ? {} : { timestamp: call.startedAt ?? call.finishedAt ?? 0 }),
    trailing: (
      <span className="inline-flex items-center gap-1.5">
        <span className={`${LOG_META} tabular-nums text-muted`}>{durationText(call)}</span>
        <ToolStatusIcon call={call} />
      </span>
    ),
    body: () => <ToolBody call={call} />,
  };
}

/** One line of a group: its own header and, when open, its body. */
function ToolLine({ call, context }: { call: ToolCall; context: OpenContext }) {
  const model = callModel(call);
  const open = context.isOpen(call.key);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="flex flex-col">
      <button type="button" aria-expanded={open} onClick={() => context.toggle(call.key)} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-muted-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <Chevron aria-hidden="true" className={`${LOG_ICON} text-muted`} />
        <span className="shrink-0 text-sm font-medium">{model.label}</span>
        <span className={`min-w-0 flex-1 truncate ${LOG_MONO} text-muted`}>{model.summary}</span>
        {model.trailing}
      </button>
      {open ? <div className="ml-6 mt-1 mb-1">{model.body?.(context)}</div> : null}
    </div>
  );
}

export function describeGroup(row: Extract<Row, { type: 'group' }>): RowModel {
  const summary = summariseGroup(row.calls);
  const first = row.calls[0]!;
  const at = first.startedAt ?? first.timestamp;
  return {
    key: row.key,
    role: 'tool',
    icon: Layers,
    iconClass: 'text-muted',
    label: `${summary.total} tool calls`,
    summary: summary.names,
    tone: summary.errors > 0 ? 'error' : 'normal',
    expandable: true,
    ...(at === undefined ? {} : { timestamp: at }),
    trailing: (
      <span className={`inline-flex items-center gap-1.5 ${LOG_META} text-muted`}>
        {summary.errors > 0 ? <span className="text-hue-red">{summary.errors} failed</span> : null}
        {summary.running > 0 ? <ToolStatusIcon call={row.calls.find((call) => call.status === 'running') ?? first} /> : null}
      </span>
    ),
    body: (context) => (
      <div className="flex flex-col">
        {row.calls.map((call) => (
          <ToolLine key={call.key} call={call} context={context} />
        ))}
      </div>
    ),
  };
}

export function describeRow(row: Row): RowModel {
  return row.type === 'group' ? describeGroup(row) : describeEntry(row.entry);
}

const PENDING_TEXT: Record<PendingMessage['state'], string> = {
  sending: 'Sending',
  delivered: 'Sent, waiting for the agent',
  seen: 'Seen by the agent, waiting for the transcript',
  failed: 'Not delivered',
};

/** A message the user just sent, before the transcript echoes it. */
export function describePending(message: PendingMessage): RowModel {
  const failed = message.state === 'failed';
  return {
    key: `pending:${message.messageId}`,
    role: 'user',
    icon: failed ? TriangleAlert : Clock,
    iconClass: failed ? 'text-hue-red' : 'text-muted',
    label: 'You',
    summary: firstLine(message.text) || `${message.imageCount} image(s)`,
    timestamp: message.sentAt,
    tone: failed ? 'error' : 'muted',
    expandable: false,
    trailing: <span className={`${LOG_META} ${failed ? 'text-hue-red' : 'text-muted'}`}>{PENDING_TEXT[message.state]}</span>,
    body: () => (
      <div className="flex flex-col gap-1">
        <p className="whitespace-pre-wrap break-words text-sm">{message.text === '' ? `${message.imageCount} image(s)` : message.text}</p>
        {failed && message.error !== undefined ? <p className={`${LOG_META} text-hue-red`}>{message.error}</p> : null}
      </div>
    ),
  };
}
