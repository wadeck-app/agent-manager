import { Circle } from 'lucide-react';
import { ATTENTION, type AgentState } from '../logic/states.js';
import type { FolderNode } from '../logic/tree.js';
import { STATE_LOOK } from '../ui/stateLook.js';

const STATE_ORDER = (Object.keys(ATTENTION) as AgentState[]).sort((a, b) => ATTENTION[b] - ATTENTION[a]);

/** The sessions of a collapsed folder as small coloured dots with a count per state, worst first. */
export function RollupDots({ node }: { node: FolderNode }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {STATE_ORDER.filter((state) => (node.counts[state] ?? 0) > 0).map((state) => (
        <span key={state} className={`inline-flex items-center gap-0.5 text-xs tabular-nums ${STATE_LOOK[state].text}`} aria-label={`${node.counts[state]} ${STATE_LOOK[state].label}`}>
          <Circle aria-hidden="true" className="h-am-dot w-am-dot fill-current" />
          {node.counts[state]}
        </span>
      ))}
    </span>
  );
}
