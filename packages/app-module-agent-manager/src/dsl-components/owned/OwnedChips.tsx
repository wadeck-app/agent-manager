import { Tooltip } from '@wadeck-app/dsl-ui';
import { Globe, ServerCog, SquareTerminal, type LucideIcon } from 'lucide-react';
import { HOST_LABEL, HOST_MEANING } from '../logic/owned.js';
import type { OwnedHostKind, SessionRowDto } from '../shared.js';
import { Chip } from '../ui/Chip.js';

const HOST_ICON: Record<OwnedHostKind, LucideIcon> = { 'stream-json': Globe, hc: SquareTerminal, bg: ServerCog };

/** The host of an owned session: 'Web' or 'Terminal', with its icon. Nothing for a discovered session (its rows stay as quiet as before). */
export function HostBadge({ session, iconOnly = false }: { session: Pick<SessionRowDto, 'launchedBy' | 'host'>; iconOnly?: boolean }) {
  if (session.launchedBy !== 'agent-manager' || session.host === null) {
    return null;
  }
  const Icon = HOST_ICON[session.host];
  return (
    <Tooltip content={iconOnly ? `${HOST_LABEL[session.host]}: ${HOST_MEANING[session.host]}` : HOST_MEANING[session.host]}>
      <Chip data-host-badge={session.host} variant="neutral" icon={<Icon className="h-am-icon-sm w-am-icon-sm" />}>
        {iconOnly ? <span className="sr-only">{HOST_LABEL[session.host]}</span> : HOST_LABEL[session.host]}
      </Chip>
    </Tooltip>
  );
}
