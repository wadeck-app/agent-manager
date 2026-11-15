import type { LocatePhase } from './useLocateCall.js';
import type { SubagentItem } from './subagentModel.js';

/** Where the sub-agents are shown (A/B test `subagents-layout`). */
export type SubagentsLayout = 'panel' | 'strip' | 'badge';
/** What is shown of them (A/B test `subagents-content`). */
export type SubagentsContent = 'summary' | 'groups' | 'timeline';

export const SUBAGENTS_LAYOUTS: readonly SubagentsLayout[] = ['panel', 'strip', 'badge'];
export const SUBAGENTS_CONTENTS: readonly SubagentsContent[] = ['summary', 'groups', 'timeline'];

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
