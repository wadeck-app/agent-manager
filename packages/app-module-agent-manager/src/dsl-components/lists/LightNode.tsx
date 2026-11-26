import type { ReactNode } from 'react';
import { herdrLight } from '../logic/herdrRow.js';
import type { AgentState } from '../logic/states.js';
import { StatusIcon } from '../ui/StatusIcon.js';

/**
 * The mark of a state in the Herdr values: a 7 px dot, a 12 px spinner, a 7 px ring, a 14 px red "!" box for Needs you (no pill with words: the names keep that room, D2026-11-26k), or the
 * page's own icon.
 */
export function LightNode({ state }: { state: AgentState }): ReactNode {
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
    return (
      <span aria-hidden="true" className="inline-flex h-3.5 w-3.5 items-center justify-center rounded bg-hue-red-bg text-[10.5px] font-bold leading-none text-hue-red">
        !
      </span>
    );
  }
  return <StatusIcon state={state} sizeClass="h-3.5 w-3.5" labelled={false} />;
}
