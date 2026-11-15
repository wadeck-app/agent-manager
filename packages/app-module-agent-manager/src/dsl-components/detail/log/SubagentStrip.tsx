import { SubagentNode } from './SubagentNode.js';
import { Bot, ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import type { SubagentDto } from '../deps.js';
import { FOCUS_RING } from '../deps.js';
import { LOG_ICON, LOG_META } from './sizes.js';
import { countSubagents } from './subagentTree.js';

export interface SubagentStripProps {
  subagents: readonly SubagentDto[];
  /** The server could not read the sub-agents folder, in words. */
  note: string;
  selected: string | undefined;
  onSelect: (agentId: string | undefined) => void;
}

/** The sub-agents of the session as a tree of chips with their state and counts. Selecting one only highlights (its log is not served). Hidden when there is none and no note. */
export function SubagentStrip({ subagents, note, selected, onSelect }: SubagentStripProps) {
  const counts = countSubagents(subagents);
  const [open, setOpen] = useState(false);
  if (counts.total === 0 && note === '') {
    return null;
  }
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="border-b border-border px-3 py-1.5">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className={`flex items-center gap-1.5 rounded ${LOG_META} text-muted hover:text-content ${FOCUS_RING}`}>
        <Chevron aria-hidden="true" className={LOG_ICON} />
        <Bot aria-hidden="true" className={LOG_ICON} />
        <span>
          {counts.total} sub-agent{counts.total === 1 ? '' : 's'}: {counts.running} running, {counts.finished} finished
        </span>
      </button>
      {note !== '' ? <p className={`mt-1 ${LOG_META} text-warning-text`}>{note}</p> : null}
      {open && counts.total > 0 ? (
        <ul className="mt-1.5 flex max-h-24 flex-row flex-wrap items-start gap-1 overflow-y-auto">
          {subagents.map((node) => (
            <SubagentNode key={node.agentId} node={node} selected={selected} onSelect={(id) => onSelect(selected === id ? undefined : id)} depth={0} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
