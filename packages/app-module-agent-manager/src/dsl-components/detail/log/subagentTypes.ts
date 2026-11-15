import type { LocatePhase } from './useLocateCall.js';
import type { SubagentItem } from './subagentModel.js';

/** What the side panel shows of the sub-agents: a status summary (the default), or a timeline of bars on a common time axis. */
export type SubagentsMode = 'summary' | 'timeline';
export const SUBAGENTS_MODES: readonly SubagentsMode[] = ['summary', 'timeline'];

/** The order of the timeline: the most recent sub-agent on top (default), or the oldest. The "now" label of the axis sits at the end the most recent one is at. */
export type TimelineOrder = 'recent' | 'oldest';

/** What every content shows and does: the list, the selection, and what the log is doing for the selected one. */
export interface SubagentContentProps {
  /** Already filtered by the status filter. */
  items: SubagentItem[];
  /** The whole list, for the headline and the counts. */
  all: SubagentItem[];
  now: number;
  selectedId: string | undefined;
  locate: LocatePhase;
  onSelect: (agentId: string) => void;
}
