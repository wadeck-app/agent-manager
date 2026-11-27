import { ArrowLeftRight, Bell, Bot, Brain, ChevronDown, ChevronRight, CircleHelp, Clock, Cpu, GitFork, Layers, ListOrdered, Terminal, TriangleAlert, User, Users, Webhook, Wrench, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { LogEntry, ReplyMessageDto, ThreadAnchor } from '../deps.js';
import { RowButton, threadAnchorOf } from '../deps.js';
import { UNCONFIRMED_AFTER_MS, type PendingMessage } from '../pending.js';
import { DeliveryMark, type MarkState } from './DeliveryMark.js';
import { PendingActions } from './PendingActions.js';
import { PriorityMark } from './PriorityMark.js';
import { firstLine, formatBytes, formatDuration } from './format.js';
import { summariseGroup, type Row, type ToolCall } from './grouping.js';
import { MetaChips } from './MetaChips.js';
import { callChips, groupChips, groupTooltip, toolLabel } from './toolChips.js';
import { Markdown } from './markdown.js';
import { LOG_ICON, LOG_META, LOG_MONO } from './sizes.js';
import { ToolBody, durationText } from './ToolBody.js';
import { ToolStatusIcon } from './ToolStatusIcon.js';
import { describeSystem, type SystemModel } from './systemModel.js';

const TOOL_LINE_BUTTON = 'flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-muted-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

/** What a row needs from its container to open nested lines (the calls of a group). */
export interface OpenContext {
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
}

/** Everything the chat frame needs to draw a row. */
export interface RowModel {
  key: string;
  /** user: right in chat; assistant: left bubble; tool and meta: plain lines; */
  role: 'user' | 'assistant' | 'tool' | 'meta';
  icon: LucideIcon;
  iconClass: string;
  label: string;
  /** One line (every collapsed header). */
  summary: string;
  timestamp?: number;
  /** Status icon, duration, counts, at the end of the header. */
  trailing?: ReactNode;
  tone: 'normal' | 'muted' | 'error';
  /** 'interrupt': a message that aborted the running tool call (an orange outline on its bubble). */
  cue?: 'interrupt';
  /** Collapsed until clicked (tool calls, thinking, notices). Messages are open. */
  expandable: boolean;
  body: ((context: OpenContext) => ReactNode) | null;
  /** A message of the conversation: the transcript entry a thread can stop at (or why it cannot). Absent for every other row. */
  anchor?: ThreadAnchor;
  /** The native tooltip of the header (a group: one line per call). */
  tooltip?: string;
  /** The id of the tool call, for the highlight of its sub-agent. */
  callId?: string;
  subagentId?: string;
  /** A run of hooks and turn rows condensed by the "Hook rows" look: the frame draws it as a footer or a chip strip when the look says so. */
  system?: SystemModel;
}

function truncatedNote(truncated: boolean, bytes: number, shownChars: number): ReactNode {
  return truncated ? <p className={`${LOG_META} text-muted`}>Shortened: the message is {formatBytes(bytes)}, {shownChars} characters are shown.</p> : null;
}

/** The server's record of a message (state, priority), by the client message id of the marker. */
export type DeliveryLookup = (messageId: string) => ReplyMessageDto | undefined;

function priorityOf(value: string | undefined): 'next' | 'now' | undefined {
  return value === 'now' || value === 'next' ? value : undefined;
}

/** The raw text of a message, one click away (the wrapper Claude Code adds around a message of another session is there). */
function rawText(text: string): ReactNode {
  return (
    <details className={LOG_META}>
      <summary className="cursor-pointer text-muted">Raw message</summary>
      <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-am-mono text-muted">{text}</pre>
    </details>
  );
}

/** A reply sent from agent-manager, as the transcript has it: the person's bubble, with the words they wrote; the wrapper of the peer message is the raw text. */
function webReplyModel(entry: Extract<LogEntry, { kind: 'user-prompt' }>, delivery: ReplyMessageDto | undefined): RowModel {
  const webReply = entry.webReply;
  const priority = priorityOf(delivery?.priority);
  return {
    key: entry.key,
    role: 'user',
    icon: User,
    iconClass: 'text-primary',
    label: 'You, via web',
    summary: firstLine(webReply?.text ?? entry.text),
    tone: 'normal',
    expandable: false,
    ...(priority === 'now' ? { cue: 'interrupt' as const } : {}),
    ...(entry.timestamp === undefined ? {} : { timestamp: entry.timestamp }),
    // The transcript shows it, so the agent has it, whatever an earlier verdict of the audit said.
    trailing: (
      <span className="flex items-center gap-1">
        {priority === undefined ? null : <PriorityMark priority={priority} />}
        <DeliveryMark state="seen" reason="The transcript shows the message" />
      </span>
    ),
    body: () => (
      <div className="flex flex-col gap-1">
        <p className="whitespace-pre-wrap break-words text-sm leading-am-log">{webReply?.text ?? entry.text}</p>
        {rawText(entry.text)}
      </div>
    ),
  };
}

function promptModel(entry: Extract<LogEntry, { kind: 'user-prompt' }>, delivery?: ReplyMessageDto): RowModel {
  if (entry.webReply !== undefined) {
    return webReplyModel(entry, delivery);
  }
  const base = { key: entry.key, tone: 'normal' as const, ...(entry.timestamp === undefined ? {} : { timestamp: entry.timestamp }) };
  const images = entry.images.length > 0 ? <p className={`${LOG_META} text-muted`}>{entry.images.length} image(s) attached, not shown.</p> : null;
  const body = (): ReactNode => (
    <div className="flex flex-col gap-1">
      <p className="whitespace-pre-wrap break-words text-sm leading-am-log">{entry.text}</p>
      {images}
      {truncatedNote(entry.textTruncated, entry.textBytes, entry.text.length)}
    </div>
  );
  // Text Claude Code wrote itself (a slash command, its output, a caveat): a quiet notice with a readable label, collapsed, the inner text one click away.
  // The text was kept whole by the server (ANSI escapes removed), so nothing is lost; an unknown tag never gets here (the server only flags known ones).
  if (entry.harness !== undefined) {
    const { harness } = entry;
    const detail = harness.detail !== '' && harness.detail !== harness.summary ? harness.detail : '';
    return {
      ...base,
      tone: harness.level === 'error' ? 'error' : 'muted',
      role: 'meta',
      icon: harness.label.startsWith('Command') || harness.label.startsWith('Shell') ? Terminal : Cpu,
      iconClass: harness.level === 'error' ? 'text-hue-red' : 'text-muted',
      label: harness.label,
      summary: harness.summary,
      expandable: detail !== '',
      body: detail === '' ? null : () => <p className="whitespace-pre-wrap break-words text-sm leading-am-log">{detail}</p>,
    };
  }
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
    body: text === '' ? null : () => <p className="whitespace-pre-wrap break-words text-sm leading-am-log">{text}</p>,
    ...(entry.timestamp === undefined ? {} : { timestamp: entry.timestamp }),
  };
}

export function describeEntry(entry: LogEntry, deliveryOf?: DeliveryLookup): RowModel {
  const model = describeEntryBase(entry, deliveryOf);
  const anchor = threadAnchorOf(entry);
  return anchor === undefined ? model : { ...model, anchor };
}

function describeEntryBase(entry: LogEntry, deliveryOf?: DeliveryLookup): RowModel {
  const at = entry.timestamp === undefined ? {} : { timestamp: entry.timestamp };
  switch (entry.kind) {
    case 'user-prompt':
      return promptModel(entry, entry.webReply === undefined ? undefined : deliveryOf?.(entry.webReply.messageId));
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
              <p className="whitespace-pre-wrap break-words text-sm leading-am-log italic text-muted">{entry.text}</p>
              {truncatedNote(entry.textTruncated, entry.textBytes, entry.text.length)}
            </div>
          ),
      };
    case 'tool-call':
      return callModel(entry);
    case 'system-notice':
      return noticeModel(entry);
    case 'hook':
      return hookModel(entry);
    case 'queue-operation': {
      const what = [entry.operation, entry.reason, entry.contentKind === undefined ? undefined : `(${entry.contentKind})`].filter(Boolean).join(' ');
      return { key: entry.key, role: 'meta', icon: ListOrdered, iconClass: 'text-muted', label: 'Queue', summary: `${what}${entry.contentPreview ? `: ${firstLine(entry.contentPreview, 100)}` : ''}`, tone: 'muted', expandable: false, body: null, ...at };
    }
    case 'fork-ref':
      return { key: entry.key, role: 'meta', icon: GitFork, iconClass: 'text-muted', label: 'Forked', summary: `from session ${entry.parentSessionId ?? 'unknown'}`, tone: 'muted', expandable: false, body: null, ...at };
    case 'usage':
      return { key: entry.key, role: 'meta', icon: Cpu, iconClass: 'text-muted', label: 'Token usage', summary: `${entry.contextEstimate} tokens of context`, tone: 'muted', expandable: false, body: null, ...at };
    case 'model-change':
      // "Model changed: Sonnet 4.6 -> Haiku 5.5" (the text is made by the core); the scope of a /model command is said in the same line, not hidden in a fold.
      return {
        key: entry.key,
        role: 'meta',
        icon: ArrowLeftRight,
        iconClass: 'text-hue-purple',
        label: 'Model changed',
        summary: `${entry.text}${entry.scope === 'session' ? ' (for this session)' : entry.scope === 'default' ? ' (saved as the default)' : ''}`,
        tone: 'normal',
        expandable: false,
        body: null,
        ...at,
      };
    case 'model-info':
      // A quiet row, visible (never hidden): which model the session started on or was switched to, as the transcript announces it.
      return { key: entry.key, role: 'meta', icon: Cpu, iconClass: 'text-muted', label: 'Model', summary: entry.displayName, tone: 'muted', expandable: false, body: null, ...at };
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
    default:
      // An entry kind a newer server sends and this page does not know: shown with its kind name, never dropped (the compiler flags a kind added without a case above).
      return unknownKindModel(entry);
  }
}

function unknownKindModel(entry: never): RowModel {
  const kind = String(Reflect.get(entry, 'kind'));
  const key = String(Reflect.get(entry, 'key'));
  return { key, role: 'meta', icon: CircleHelp, iconClass: 'text-muted', label: 'Unrecognised entry', summary: `kind "${kind}": this page does not know how to show it`, tone: 'muted', expandable: false, body: null };
}

const HOOK_OUTCOME_TEXT: Record<Extract<LogEntry, { kind: 'hook' }>['outcome'], string> = {
  success: '',
  error: 'error (not blocking)',
  cancelled: 'cancelled',
  message: 'message',
  async: 'async response',
  other: 'unknown outcome',
};

/** A hook of Claude Code: a quiet collapsed row, read-only; the command, the exit code, the output and the errors are one click away. */
function hookModel(entry: Extract<LogEntry, { kind: 'hook' }>): RowModel {
  const failed = entry.outcome === 'error' || entry.outcome === 'cancelled';
  const outcome = HOOK_OUTCOME_TEXT[entry.outcome];
  const facts = [
    entry.command === undefined ? undefined : `Command: ${entry.command}`,
    entry.exitCode === undefined ? undefined : `Exit code: ${entry.exitCode}`,
    entry.timedOut === true ? `Timed out${entry.timeoutMs === undefined ? '' : ` after ${formatDuration(entry.timeoutMs)}`}` : undefined,
    entry.toolUseId === undefined ? undefined : `Id: ${entry.toolUseId}`,
    entry.outcome === 'other' ? `Attachment type: ${entry.attachmentType}` : undefined,
  ].filter((fact): fact is string => fact !== undefined);
  return {
    key: entry.key,
    role: 'meta',
    icon: Webhook,
    iconClass: failed ? 'text-hue-red' : 'text-muted',
    label: 'Hook',
    summary: [entry.hookName, outcome, entry.output === undefined ? '' : firstLine(entry.output, 100)].filter((part) => part !== '').join(' - '),
    tone: failed ? 'error' : 'muted',
    expandable: true,
    ...(entry.timestamp === undefined ? {} : { timestamp: entry.timestamp }),
    ...(entry.durationMs === undefined ? {} : { trailing: <span className={`${LOG_META} tabular-nums text-muted`}>{formatDuration(entry.durationMs)}</span> }),
    body: () => (
      <div className="flex flex-col gap-1">
        {facts.length === 0 ? null : <p className={`${LOG_META} whitespace-pre-wrap break-words text-muted`}>{facts.join('\n')}</p>}
        {entry.output === undefined ? null : <pre className={`max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-muted-bg p-2 ${LOG_MONO}`}>{entry.output}</pre>}
        {entry.outputTruncated === true ? <p className={`${LOG_META} text-muted`}>Shortened: the output is cut at {entry.output?.length} characters.</p> : null}
        {entry.stderr === undefined ? null : <pre className={`max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-muted-bg p-2 text-hue-red ${LOG_MONO}`}>{entry.stderr}</pre>}
        {entry.output === undefined && entry.stderr === undefined ? <p className={`${LOG_META} text-muted`}>This hook printed nothing.</p> : null}
      </div>
    ),
  };
}

function callModel(call: ToolCall): RowModel {
  const orphan = call.orphan === true;
  return {
    key: call.key,
    role: 'tool',
    icon: Wrench,
    iconClass: 'text-muted',
    label: orphan ? 'Tool result' : toolLabel(call),
    summary: orphan ? firstLine(call.resultPreview ?? '') : call.inputSummary,
    tone: call.status === 'error' ? 'error' : 'normal',
    expandable: true,
    callId: call.id,
    ...(call.subagentId === undefined ? {} : { subagentId: call.subagentId }),
    ...(call.startedAt === undefined && call.finishedAt === undefined ? {} : { timestamp: call.startedAt ?? call.finishedAt ?? 0 }),
    trailing: (
      <span className="inline-flex items-center gap-1.5">
        {orphan ? null : <MetaChips chips={callChips(call)} />}
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
      <RowButton type="button" aria-expanded={open} onClick={() => context.toggle(call.key)} className={TOOL_LINE_BUTTON}>
        <Chevron aria-hidden="true" className={`${LOG_ICON} text-muted`} />
        <span className="shrink-0 text-sm font-medium">{model.label}</span>
        <span className={`min-w-0 flex-1 truncate ${LOG_MONO} text-muted`}>{model.summary}</span>
        {model.trailing}
      </RowButton>
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
    tooltip: groupTooltip(row.calls),
    ...(at === undefined ? {} : { timestamp: at }),
    trailing: (
      <span className={`inline-flex items-center gap-1.5 ${LOG_META} text-muted`}>
        <MetaChips chips={groupChips(row.calls)} />
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

export function describeRow(row: Row, deliveryOf?: DeliveryLookup): RowModel {
  if (row.type === 'system') {
    return describeSystem(row, (entry) => describeEntry(entry, deliveryOf));
  }
  return row.type === 'group' ? describeGroup(row) : describeEntry(row.entry, deliveryOf);
}

/** What a pending message is shown as: sending, delivered, seen, a problem, or (nothing in the transcript after UNCONFIRMED_AFTER_MS) not confirmed. */
export function pendingMark(message: PendingMessage, now: number): { state: MarkState; reason: string; hint: string } {
  if (message.state === 'failed') {
    return { state: 'failed', reason: message.error ?? 'Nothing was sent.', hint: '' };
  }
  if ((message.state === 'sending' || message.state === 'delivered') && now - message.sentAt > UNCONFIRMED_AFTER_MS) {
    return { state: 'unconfirmed', reason: 'The transcript has not shown this message yet.', hint: 'Check that the session is still open and accepts messages from other sessions.' };
  }
  const reason = message.state === 'sending' ? 'The request is in flight.' : message.state === 'delivered' ? 'Sent to the session; waiting for it to appear in the transcript.' : 'The agent took it; waiting for the transcript.';
  return { state: message.state, reason, hint: '' };
}

/** A message the user just sent, before the transcript echoes it: at the end of the log, with its delivery and priority as small marks. */
export function describePending(message: PendingMessage, now: number): RowModel {
  const mark = pendingMark(message, now);
  const problem = mark.state === 'failed';
  return {
    key: `pending:${message.messageId}`,
    role: 'user',
    icon: problem ? TriangleAlert : Clock,
    iconClass: problem ? 'text-hue-red' : 'text-muted',
    label: 'You',
    summary: firstLine(message.text) || `${message.imageCount} image(s)`,
    timestamp: message.sentAt,
    tone: problem ? 'error' : 'muted',
    expandable: false,
    ...(message.priority === 'now' ? { cue: 'interrupt' as const } : {}),
    trailing: (
      <span className="flex items-center gap-1">
        {message.priority === undefined ? null : <PriorityMark priority={message.priority} />}
        <DeliveryMark state={mark.state} reason={mark.reason} hint={mark.hint} />
        {mark.state === 'failed' || mark.state === 'unconfirmed' ? <PendingActions message={message} /> : null}
      </span>
    ),
    body: () => (
      <div className="flex flex-col gap-1">
        <p className="whitespace-pre-wrap break-words text-sm leading-am-log">{message.text === '' ? `${message.imageCount} image(s)` : message.text}</p>
        {problem && message.error !== undefined ? <p className={`${LOG_META} text-hue-red`}>{message.error}</p> : null}
      </div>
    ),
  };
}
