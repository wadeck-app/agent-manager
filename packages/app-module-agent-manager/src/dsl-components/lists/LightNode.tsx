import type { ReactNode } from 'react';
import { herdrLight } from '../logic/herdrRow.js';
import type { AgentState } from '../logic/states.js';
import { StatusIcon } from '../ui/StatusIcon.js';

/**
 * The mark of a state in the Herdr values: a 7 px dot, a 12 px spinner, a 7 px ring, the "Needs you" pill (10.5 px semibold, 18 px high, 5 px radius), or the
 * page's own icon. `compact` (a group header, where the words are the row's job): a 14 px red "!" box instead of the pill.
 */
export function LightNode({ state, compact }: { state: AgentState; compact: boolean }): ReactNode {
  const light = herdrLight(state);
  if (light.kind === 'dot') {
    return <span aria-hidden="true" className="inline-block h-[7px] w-[7px] rounded-full bg-hue-blue" />;
  }
  if (light.kind === 'ring') {
    return <span aria-hidden="true" className="inline-block h-[7px] w-[7px] rounded-full border-[1.5px] border-muted" />;
  }
  if (light.kind === 'spinner') {
    return <StatusIcon state="working" sizeClass="h-3 w-3" labelled={false} />;
  }
  if (light.kind === 'pill') {
    return compact ? (
      <span aria-hidden="true" className="inline-flex h-3.5 w-3.5 items-center justify-center rounded bg-hue-red-bg text-[10.5px] font-bold leading-none text-hue-red">
        !
      </span>
    ) : (
      <span className="inline-flex h-[18px] items-center rounded-[5px] bg-hue-red-bg px-1.5 text-[10.5px] font-semibold leading-none text-hue-red">{light.label}</span>
    );
  }
  return <StatusIcon state={state} sizeClass="h-3.5 w-3.5" labelled={false} />;
}
