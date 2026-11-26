import { Tooltip } from '@wadeck-app/dsl-ui';
import { STATE_LABEL, type AgentState } from '../logic/states.js';
import { StatusColumn } from '../ui/StatusColumn.js';
import { LightNode } from './LightNode.js';

/** The most urgent state of a group, in the same column and the same marks as the rows (a group header shows it folded or not, where it says something). */
export function RollupLight({ state, subject }: { state: AgentState; subject: 'folder' | 'group' }) {
  return (
    <Tooltip content={`${STATE_LABEL[state]}: the most urgent state in this ${subject}`} side="left">
      <span className="inline-flex shrink-0">
        <StatusColumn>
          <span role="img" aria-label={STATE_LABEL[state]} data-rollup-light={state} className="inline-flex items-center">
            <LightNode state={state} />
          </span>
        </StatusColumn>
      </span>
    </Tooltip>
  );
}
