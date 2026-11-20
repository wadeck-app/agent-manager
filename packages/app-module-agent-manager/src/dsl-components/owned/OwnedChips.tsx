import { Globe, SquareTerminal, type LucideIcon } from 'lucide-react';
import { HOST_LABEL, HOST_MEANING } from '../logic/owned.js';
import type { SessionRowDto } from '../shared.js';
import { Tooltip } from '../ui/Tooltip.js';

const HOST_ICON: Record<'stream-json' | 'hc', LucideIcon> = { 'stream-json': Globe, hc: SquareTerminal };

/** The shape shared by the chips of an owned session. */
export const CHIP = 'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-xs';

/** The host of an owned session: 'Web' or 'Terminal', with its icon. Nothing for a discovered session (its rows stay as quiet as before). */
export function HostBadge({ session }: { session: Pick<SessionRowDto, 'launchedBy' | 'host'> }) {
  if (session.launchedBy !== 'agent-manager' || session.host === null) {
    return null;
  }
  const Icon = HOST_ICON[session.host];
  return (
    <Tooltip content={HOST_MEANING[session.host]}>
      <span data-host-badge={session.host} className={`${CHIP} border border-border text-muted`}>
        <Icon aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
        {HOST_LABEL[session.host]}
      </span>
    </Tooltip>
  );
}
