import type { ReactNode } from 'react';
import type { AgentRow } from '../data/types.js';
import { herdrLight } from '../logic/herdrRow.js';
import { STATE_MEANING } from '../logic/states.js';
import { Chip } from '../ui/Chip.js';
import { StatusIcon } from '../ui/StatusIcon.js';
import { Tooltip } from '../ui/Tooltip.js';

/** The state light on the right of a Herdr row: a dot, a spinner, a pill with words, a ring, or the page's own icon. */
export function HerdrLightView({ session }: { session: AgentRow }) {
  const light = herdrLight(session.state);
  let node: ReactNode;
  if (light.kind === 'dot') {
    node = <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full bg-primary" />;
  } else if (light.kind === 'ring') {
    node = <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full border-2 border-muted" />;
  } else if (light.kind === 'spinner') {
    node = <StatusIcon state="working" sizeClass="h-am-icon-sm w-am-icon-sm" labelled={false} />;
  } else if (light.kind === 'pill') {
    node = <Chip variant="danger">{light.label}</Chip>;
  } else {
    node = <StatusIcon state={session.state} sizeClass="h-am-icon-sm w-am-icon-sm" labelled={false} />;
  }
  return (
    <Tooltip content={STATE_MEANING[session.state]} side="left">
      <span data-herdr-light={light.kind} className="inline-flex shrink-0 items-center">
        {node}
        {light.kind === 'pill' ? null : <span className="sr-only">{light.label}</span>}
      </span>
    </Tooltip>
  );
}
