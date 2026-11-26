import { CircleAlert, LoaderCircle, Target } from 'lucide-react';
import { FOCUS_RING } from '../deps.js';
import { SubagentTip } from './SubagentTip.js';
import type { LocatePhase } from './useLocateCall.js';
import { elapsedMs, formatElapsed, lastActivityText, STATUS_LOOK, type SubagentItem } from './subagentModel.js';

/** Left padding per nesting level (written in full for Tailwind). */
const INDENT = ['pl-2', 'pl-5', 'pl-8', 'pl-11'] as const;

export interface SubagentRowProps {
  item: SubagentItem;
  now: number;
  selected: boolean;
  /** What the log is doing for the selected row (searching for its call, showing it, could not find it); ignored on the others. */
  locate: LocatePhase;
  onSelect: (agentId: string) => void;
  /** Nesting is drawn only where the list keeps the tree order (the summary list). */
  nested?: boolean;
}

/** The words that say what the click did, on the selected row: persistent, next to the row, not a toast. */
function locateWords(phase: LocatePhase): { text: string; tone: string; busy: boolean } | undefined {
  switch (phase) {
    case 'searching':
      return { text: 'Looking for the call...', tone: 'text-muted', busy: true };
    case 'found':
      return { text: 'Showing the call', tone: 'text-primary', busy: false };
    case 'missing':
      return { text: 'Call not found', tone: 'text-warning-text', busy: false };
    case 'error':
      return { text: 'Search failed', tone: 'text-danger-text', busy: false };
    case 'idle':
      return undefined;
  }
}

/** One sub-agent: status icon (shape and colour), name, type and model, time worked (live while it runs). Clicking selects it and shows the call that started it in the log. */
export function SubagentRow({ item, now, selected, locate, onSelect, nested = false }: SubagentRowProps) {
  const look = STATUS_LOOK[item.status];
  const Icon = look.icon;
  const elapsed = elapsedMs(item, now);
  const words = selected ? locateWords(locate) : undefined;
  const { dto } = item;
  const detail = [dto.agentType, dto.model].filter(Boolean).join(' - ');
  return (
    <li>
      <SubagentTip item={item} now={now}>
      <button
        type="button"
        data-tip-fill=""
        aria-pressed={selected}
        onClick={() => onSelect(dto.agentId)}
        className={`flex w-full min-w-0 items-start gap-2 rounded border-l-2 py-1.5 pr-2 text-left text-sm ${nested ? INDENT[Math.min(item.depth, INDENT.length - 1)] : 'pl-2'} ${selected ? 'border-primary bg-primary-light' : 'border-transparent hover:bg-muted-bg'} ${FOCUS_RING}`}
      >
        <Icon aria-hidden="true" className={`mt-0.5 h-am-icon w-am-icon shrink-0 ${look.text} ${look.iconClass}`} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate font-medium text-content">{item.title}</span>
            {elapsed !== undefined ? <span className="shrink-0 text-xs tabular-nums text-muted">{formatElapsed(elapsed)}</span> : null}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span className={look.text}>{look.label}</span>
            {item.status === 'active' && dto.lastActivityAt !== undefined ? <span className="truncate">{lastActivityText(dto.lastActivityAt, now)}</span> : null}
            {item.status === 'unknown' && dto.readError !== undefined ? <span className="truncate">{dto.readError}</span> : null}
            {item.status === 'failed' && dto.failureReason !== undefined ? <span className="truncate">{dto.failureReason}</span> : null}
            {detail !== '' ? <span className="truncate">{detail}</span> : null}
          </span>
          {words !== undefined ? (
            <span className={`mt-0.5 flex items-center gap-1 text-xs font-medium ${words.tone}`}>
              {words.busy ? <LoaderCircle aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0 animate-spin motion-reduce:animate-none" /> : locate === 'found' ? <Target aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0" /> : <CircleAlert aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0" />}
              {words.text}
            </span>
          ) : null}
        </span>
      </button>
      </SubagentTip>
    </li>
  );
}
