import { TriangleAlert, Webhook } from 'lucide-react';
import type { ReactNode } from 'react';
import { RowButton } from '../deps.js';
import type { LogEntry } from '../deps.js';
import { ExpandMark } from './ExpandMark.js';
import { formatDuration } from './format.js';
import type { Row, SystemEntry } from './grouping.js';
import type { OpenContext, RowModel } from './rowModel.js';
import { LOG_ICON, LOG_MONO } from './sizes.js';

const LINE_BASE = 'flex w-full items-center gap-2 rounded px-1 py-0.5 text-left';
const LINE_BUTTON = `${LINE_BASE} hover:bg-muted-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`;

/** One thing the condensed row says, in words: a hook (or several of the same name), the Stop hook summary, the duration of the turn. */
export interface SystemPart {
  id: string;
  kind: 'hook' | 'turn';
  /** The full short sentence: "PreToolUse:Bash x3", "stop-hook", "turn took 32 s", "Stop failed". */
  text: string;
  failed: boolean;
}

/** What the condensed row carries (a run of hooks and turn rows shown as ONE line "System"). */
export interface SystemModel {
  parts: SystemPart[];
  failed: boolean;
}

function partOf(entry: SystemEntry): SystemPart {
  if (entry.kind === 'hook') {
    const failed = entry.outcome === 'error' || entry.outcome === 'cancelled';
    const text = failed ? `${entry.hookName} ${entry.outcome === 'error' ? 'failed' : 'cancelled'}` : entry.hookName;
    return { id: `${entry.hookName}:${failed}`, kind: 'hook', text, failed };
  }
  if (entry.noticeKind === 'turn-duration') {
    const took = entry.durationMs === undefined ? 'turn ended' : `turn took ${formatDuration(entry.durationMs)}`;
    return { id: `turn:${entry.key}`, kind: 'turn', text: took, failed: false };
  }
  const errors = entry.hookErrorCount ?? 0;
  const text = errors > 0 ? `stop-hook: ${errors} hook error(s)` : 'stop-hook';
  return { id: `stop:${errors > 0}`, kind: 'hook', text, failed: entry.level === 'error' || errors > 0 };
}

/** The parts of a run: the same hook name met several times is one part with a count ("PreToolUse:Bash x3"); a failed one is never merged into an ok one. */
export function systemParts(entries: readonly SystemEntry[]): SystemPart[] {
  const parts: SystemPart[] = [];
  const seen = new Map<string, { index: number; count: number; base: SystemPart }>();
  for (const entry of entries) {
    const part = partOf(entry);
    const known = entry.kind === 'system-notice' && entry.noticeKind === 'turn-duration' ? undefined : seen.get(part.id);
    if (known === undefined) {
      seen.set(part.id, { index: parts.length, count: 1, base: part });
      parts.push(part);
    } else {
      known.count += 1;
      parts[known.index] = { ...known.base, text: `${known.base.text} x${known.count}` };
    }
  }
  return parts;
}

/**
 * One line of an opened run: its own header (the full row, folded) and, when open, its body. A line with nothing to open (a stop-hook without output, a turn
 * duration that only repeats its own header) is a static line with a faint chevron in the same slot, not a button.
 */
function SystemLine({ entry, context, describe }: { entry: SystemEntry; context: OpenContext; describe: (entry: LogEntry) => RowModel }) {
  const model = describe(entry);
  const open = model.expandable && context.isOpen(entry.key);
  const Icon = model.icon;
  const labelClass = `text-sm font-medium ${model.expandable ? 'shrink-0' : ''} ${model.tone === 'error' ? 'text-hue-red' : ''}`;
  const inside = (
    <>
      <ExpandMark open={open} enabled={model.expandable} />
      <Icon aria-hidden="true" className={`${LOG_ICON} ${model.iconClass}`} />
      {model.expandable ? (
        <>
          <span className={labelClass}>{model.label}</span>
          <span className={`min-w-0 flex-1 truncate ${LOG_MONO} text-muted`}>{model.summary}</span>
        </>
      ) : (
        // Nothing to open: the whole line is shown, wrapping as text does (label and summary flow together on a narrow pane).
        <span className="min-w-0 flex-1 break-words">
          <span className={labelClass}>{model.label}</span> <span className={`${LOG_MONO} text-muted`}>{model.summary}</span>
        </span>
      )}
      {model.trailing}
    </>
  );
  return (
    <div className="flex flex-col" data-system-line={model.expandable ? 'expandable' : 'static'}>
      {model.expandable ? (
        <RowButton type="button" aria-expanded={open} onClick={() => context.toggle(entry.key)} className={LINE_BUTTON}>
          {inside}
        </RowButton>
      ) : (
        <div className={LINE_BASE}>{inside}</div>
      )}
      {open ? <div className="ml-6 mb-1 mt-1">{model.body?.(context)}</div> : null}
    </div>
  );
}

/** The individual lines of a run, as the body of the condensed row: nothing of the separate rows is lost. */
function systemBody(entries: readonly SystemEntry[], describe: (entry: LogEntry) => RowModel): (context: OpenContext) => ReactNode {
  return (context) => (
    <div className="flex flex-col" data-system-lines="">
      {entries.map((entry) => (
        <SystemLine key={entry.key} entry={entry} context={context} describe={describe} />
      ))}
    </div>
  );
}

/** The model of a condensed run; `describe` is the model of one entry as a row of its own. */
export function describeSystem(row: Extract<Row, { type: 'system' }>, describe: (entry: LogEntry) => RowModel): RowModel {
  const parts = systemParts(row.entries);
  const failed = parts.some((part) => part.failed);
  const first = row.entries[0]!;
  // The run opens only when a line of it has more to say than the summary does: something to expand, or a figure the summary leaves out (the duration of a hook).
  // A stop-hook and a turn duration alone are already told whole by the summary: the row is a plain line with a faint chevron.
  const anything = row.entries.some((entry) => {
    const line = describe(entry);
    return line.expandable || line.trailing !== undefined;
  });
  return {
    key: row.key,
    role: 'meta',
    icon: failed ? TriangleAlert : Webhook,
    iconClass: failed ? 'text-hue-red' : 'text-muted',
    label: 'System',
    summary: parts.map((part) => part.text).join(', '),
    tone: failed ? 'error' : 'muted',
    expandable: anything,
    ...(first.timestamp === undefined ? {} : { timestamp: first.timestamp }),
    body: anything ? systemBody(row.entries, describe) : null,
    system: { parts, failed },
  };
}
