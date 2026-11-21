import { Inbox, LayoutList, ListTree, type LucideIcon } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { MODE_LABEL, MODES, type ModeId } from '../shared.js';
import { FOCUS_RING } from '../ui/IconButton.js';

const MODE_ICON: Record<ModeId, LucideIcon> = { tree: ListTree, groups: LayoutList, inbox: Inbox };

const MODE_HINT: Record<ModeId, string> = {
  tree: 'Agents under their working directory, sub-agents nested',
  groups: 'Agents by state: Needs you, Done, Working, Idle',
  inbox: 'What needs you first, in tabs',
};

/**
 * The toggle between the ways to list the agents: a segmented control (a radio group: arrows move, the selection follows the focus) with an icon and a label
 * per mode. The mode is in the URL (?mode=) and remembered; see logic/mode.ts.
 */
export function ModeToggle({ mode, onMode, iconOnly = false }: { mode: ModeId; onMode: (mode: ModeId) => void; iconOnly?: boolean }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) {
      return;
    }
    event.preventDefault();
    const next = MODES[(MODES.indexOf(mode) + step + MODES.length) % MODES.length];
    if (next !== undefined) {
      onMode(next);
      queueMicrotask(() => document.getElementById(`agents-mode-${next}`)?.focus());
    }
  };
  return (
    <div role="radiogroup" aria-label="Listing mode" onKeyDown={onKeyDown} className="inline-flex shrink-0 rounded-md bg-muted-bg p-0.5">
      {MODES.map((id) => {
        const Icon = MODE_ICON[id];
        const active = id === mode;
        return (
          <button
            key={id}
            id={`agents-mode-${id}`}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            title={iconOnly ? `${MODE_LABEL[id]}: ${MODE_HINT[id]}` : MODE_HINT[id]}
            onClick={() => onMode(id)}
            className={`inline-flex h-[calc(var(--am-hit)-0.25rem)] items-center gap-1.5 rounded ${iconOnly ? 'px-2' : 'px-2.5'} text-sm ${active ? 'bg-surface font-medium text-content shadow-sm' : 'text-muted hover:text-content'} ${FOCUS_RING}`}
          >
            <Icon aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0" />
            {iconOnly ? <span className="sr-only">{MODE_LABEL[id]}</span> : MODE_LABEL[id]}
          </button>
        );
      })}
    </div>
  );
}
