import { Bot } from 'lucide-react';
import type { SubagentDto } from '../deps.js';
import { SubagentNode } from './SubagentNode.js';
import { LOG_ICON, LOG_META } from './sizes.js';
import { countSubagents } from './subagentTree.js';

export interface SubagentPanelProps {
  subagents: readonly SubagentDto[];
  note: string;
  selected: string | undefined;
  onSelect: (agentId: string | undefined) => void;
}

/**
 * The third zone of a very wide screen (1920 px and up): the sub-agents of the session as a tree that is always open, beside the log. Below that width
 * the SubagentStrip (a collapsed line above the log) shows the same data, so a narrow screen loses nothing; the log viewer renders one of the two (useMinWidth). Not rendered when the session has none.
 */
export function SubagentPanel({ subagents, note, selected, onSelect }: SubagentPanelProps) {
  const counts = countSubagents(subagents);
  if (counts.total === 0 && note === '') {
    return null;
  }
  return (
    <aside aria-label="Sub-agents" className="flex min-h-0 w-80 shrink-0 flex-col border-l border-border">
      <h3 className={`flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-2 ${LOG_META} font-medium text-content`}>
        <Bot aria-hidden="true" className={LOG_ICON} />
        <span>
          {counts.total} sub-agent{counts.total === 1 ? '' : 's'}: {counts.running} running, {counts.finished} finished
        </span>
      </h3>
      {note !== '' ? <p className={`px-3 pt-2 ${LOG_META} text-warning-text`}>{note}</p> : null}
      <ul className="flex min-h-0 flex-1 flex-col items-start gap-1 overflow-y-auto overscroll-contain p-3">
        {subagents.map((node) => (
          <SubagentNode key={node.agentId} node={node} selected={selected} onSelect={(id) => onSelect(selected === id ? undefined : id)} depth={0} />
        ))}
      </ul>
    </aside>
  );
}
