import type { AgentRow } from '../deps.js';
import type { SubagentsContent, SubagentsLayout } from './subagentTypes.js';

export interface LogViewerProps {
  session: AgentRow;
  /** Where the sub-agents are shown (A/B test `subagents-layout`, chosen by AgentDetail). Default: the side panel. */
  subagentsLayout?: SubagentsLayout;
  /** What is shown of them (A/B test `subagents-content`). Default: the summary. */
  subagentsContent?: SubagentsContent;
}
