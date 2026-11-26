import { Tooltip } from '@wadeck-app/dsl-ui';
import type { AgentRow } from '../data/types.js';
import { STATE_MEANING } from '../logic/states.js';
import { StatusIcon } from '../ui/StatusIcon.js';

/** The state icon with the meaning of the state in its tooltip. */
export function StateIconTip({ session, sizeClass }: { session: AgentRow; sizeClass?: string }) {
  return (
    <Tooltip content={session.model === undefined ? STATE_MEANING[session.state] : `${STATE_MEANING[session.state]} Model: ${session.model.displayName}.`} side="left">
      <span className="inline-flex">
        <StatusIcon state={session.state} sizeClass={sizeClass} />
      </span>
    </Tooltip>
  );
}
