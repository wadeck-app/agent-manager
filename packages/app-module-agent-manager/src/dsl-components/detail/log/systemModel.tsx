import { ChevronDown, ChevronRight, TriangleAlert, Webhook } from 'lucide-react';
import type { ReactNode } from 'react';
import { RowButton } from '../deps.js';
import type { LogEntry } from '../deps.js';
import { formatDuration } from './format.js';
import type { Row, SystemEntry } from './grouping.js';
import type { OpenContext, RowModel } from './rowModel.js';
import { LOG_ICON, LOG_MONO } from './sizes.js';

const LINE_BUTTON = 'flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-muted-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

/** One thing the condensed rows say, in words: a hook (or several of the same name), the Stop hook summary, the duration of the turn. */
export interface SystemPart {
  id: string;
  kind: 'hook' | 'turn';
  /** The full short sentence: "PreToolUse:Bash x3", "stop-hook", "turn took 32 s", "Stop failed". */
  text: string;
  /** The same for a chip, shorter: "32 s" for the turn. */
  chip: string;
  failed: boolean;
  /** The details, one per line (the tooltip). */
  tip: string;
}

/** What a condensed row of the "Hook rows" look carries; the rows of the look "rows" never have it. */
export interface SystemModel {
  look: 'merged' | 'footer' | 'chips';
  parts: SystemPart[];
  failed: boolean;
}

const OUTCOME: Record<Extract<LogEntry, { kind: 'hook' }>['outcome'], string> = { success: 'ok', error: 'error (not blocking)', cancelled: 'cancelled', message: 'message', async: 'async response', other: 'unknown outcome' };

function partOf(entry: SystemEntry): SystemPart {
  if (entry.kind === 'hook') {
    const failed = entry.outcome === 'error' || entry.outcome === 'cancelled';
    const text = failed ? `${entry.hookName} ${entry.outcome === 'error' ? 'failed' : 'cancelled'}` : entry.hookName;
    const detail = [OUTCOME[entry.outcome], entry.durationMs === undefined ? '' : formatDuration(entry.durationMs), entry.exitCode === undefined ? '' : `exit ${entry.exitCode}`].filter((part) => part !== '').join(', ');
    return { id: `${entry.hookName}:${failed}`, kind: 'hook', text, chip: text, failed, tip: `${entry.hookName}: ${detail}` };
  }
  if (entry.noticeKind === 'turn-duration') {
    const took = entry.durationMs === undefined ? 'turn ended' : `turn took ${formatDuration(entry.durationMs)}`;
    return { id: `turn:${entry.key}`, kind: 'turn', text: took, chip: entry.durationMs === undefined ? 'turn' : `took ${formatDuration(entry.durationMs)}`, failed: false, tip: entry.messageCount === undefined ? took : `${took} (${entry.messageCount} messages)` };
  }
  const errors = entry.hookErrorCount ?? 0;
  const text = errors > 0 ? `stop-hook: ${errors} hook error(s)` : 'stop-hook';
  const detail = [entry.hookCount === undefined ? '' : `${entry.hookCount} hook(s)`, errors > 0 ? `${errors} error(s)` : '', entry.durationMs === undefined ? '' : formatDuration(entry.durationMs), entry.preventedContinuation === true ? 'prevented continuation' : ''].filter((part) => part !== '').join(', ');
  return { id: `stop:${errors > 0}`, kind: 'hook', text, chip: text, failed: entry.level === 'error' || errors > 0, tip: detail === '' ? 'stop-hook' : `stop-hook: ${detail}` };
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
      parts[known.index] = { ...known.base, text: `${known.base.text} x${known.count}`, chip: `${known.base.chip} x${known.count}`, tip: `${parts[known.index]!.tip}\n${part.tip}` };
    }
  }
  return parts;
}

/** The words of the footer look: the turn first (the sentence the person wants), then what ran; a hook "ran" (a failure says itself). */
export function footerText(parts: readonly SystemPart[]): string {
  return [...parts.filter((part) => part.kind === 'turn'), ...parts.filter((part) => part.kind === 'hook')].map((part) => (part.kind === 'hook' && !part.failed ? `${part.text} ran` : part.text)).join(', ');
}

/** One line of an opened run: its own header (the full row of the "rows" look, folded) and, when open, its body. */
function SystemLine({ entry, context, describe }: { entry: SystemEntry; context: OpenContext; describe: (entry: LogEntry) => RowModel }) {
  const model = describe(entry);
  const open = context.isOpen(entry.key);
  const Chevron = open ? ChevronDown : ChevronRight;
  const Icon = model.icon;
  return (
    <div className="flex flex-col">
      <RowButton type="button" aria-expanded={open} onClick={() => context.toggle(entry.key)} className={LINE_BUTTON}>
        <Chevron aria-hidden="true" className={`${LOG_ICON} text-muted`} />
        <Icon aria-hidden="true" className={`${LOG_ICON} ${model.iconClass}`} />
        <span className={`shrink-0 text-sm font-medium ${model.tone === 'error' ? 'text-hue-red' : ''}`}>{model.label}</span>
        <span className={`min-w-0 flex-1 truncate ${LOG_MONO} text-muted`}>{model.summary}</span>
        {model.trailing}
      </RowButton>
      {open ? <div className="ml-6 mb-1 mt-1">{model.body?.(context)}</div> : null}
    </div>
  );
}

/** The individual lines of a run, as the body of the condensed row: nothing of the rows of the look "rows" is lost. */
function systemBody(entries: readonly SystemEntry[], describe: (entry: LogEntry) => RowModel): (context: OpenContext) => ReactNode {
  return (context) => (
    <div className="flex flex-col" data-system-lines="">
      {entries.map((entry) => (
        <SystemLine key={entry.key} entry={entry} context={context} describe={describe} />
      ))}
    </div>
  );
}

/** The model of a condensed run (looks merged, footer, chips); `describe` is the model of one entry as a row of its own. */
export function describeSystem(row: Extract<Row, { type: 'system' }>, describe: (entry: LogEntry) => RowModel): RowModel {
  const parts = systemParts(row.entries);
  const failed = parts.some((part) => part.failed);
  const first = row.entries[0]!;
  return {
    key: row.key,
    role: 'meta',
    icon: failed ? TriangleAlert : Webhook,
    iconClass: failed ? 'text-hue-red' : 'text-muted',
    label: 'System',
    summary: parts.map((part) => part.text).join(', '),
    tone: failed ? 'error' : 'muted',
    expandable: true,
    ...(first.timestamp === undefined ? {} : { timestamp: first.timestamp }),
    body: systemBody(row.entries, describe),
    system: { look: row.look, parts, failed },
  };
}
