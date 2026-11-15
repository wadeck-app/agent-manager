import { ChartGantt, ListChecks, type LucideIcon } from 'lucide-react';
import { FOCUS_RING } from '../deps.js';
import { SUBAGENTS_MODES, type SubagentsMode } from './subagentTypes.js';

const MODES: Record<SubagentsMode, { label: string; icon: LucideIcon; hint: string }> = {
  summary: { label: 'Summary', icon: ListChecks, hint: 'Progress and counts, what needs the eye first' },
  timeline: { label: 'Timeline', icon: ChartGantt, hint: 'One bar per sub-agent on a common time axis' },
};

/** The choice of what the panel shows (an alternative mode, remembered): icon buttons with their words, one pressed. */
export function SubagentModeSwitch({ mode, onMode }: { mode: SubagentsMode; onMode: (next: SubagentsMode) => void }) {
  return (
    <div role="group" aria-label="Sub-agents view" className="inline-flex rounded border border-border p-0.5">
      {SUBAGENTS_MODES.map((value) => {
        const { label, icon: Icon, hint } = MODES[value];
        const pressed = mode === value;
        return (
          <button
            key={value}
            type="button"
            aria-pressed={pressed}
            title={hint}
            onClick={() => onMode(value)}
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs ${pressed ? 'bg-primary-light text-content' : 'text-muted hover:bg-muted-bg hover:text-content'} ${FOCUS_RING}`}
          >
            <Icon aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0" />
            {label}
          </button>
        );
      })}
    </div>
  );
}
