import type { AgentRow } from '../data/types.js';
import { STATE_MEANING } from '../logic/states.js';
import { StatusIcon } from '../ui/StatusIcon.js';
import { Tooltip } from '../ui/Tooltip.js';

/** The state icon with the meaning of the state in its tooltip. */
export function StateIconTip({ session, sizeClass }: { session: AgentRow; sizeClass?: string }) {
  return (
    <Tooltip content={STATE_MEANING[session.state]} side="left">
      <span className="inline-flex">
        <StatusIcon state={session.state} sizeClass={sizeClass} />
      </span>
    </Tooltip>
  );
}
