import type { AgentRow } from '../data/types.js';
import { STATE_LOOK } from '../ui/stateLook.js';
import { StatusIcon } from '../ui/StatusIcon.js';

/** The status pill of a card: icon and text in the colours of the state (the colour is never the only signal). */
export function StatusPill({ session }: { session: AgentRow }) {
  const look = STATE_LOOK[session.state];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs ${look.bg} ${look.text}`}>
      <StatusIcon state={session.state} sizeClass="h-am-icon-sm w-am-icon-sm" labelled={false} />
      {look.label}
    </span>
  );
}
