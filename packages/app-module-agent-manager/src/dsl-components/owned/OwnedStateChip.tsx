import { CircleAlert, CircleX, LoaderCircle, OctagonAlert, type LucideIcon } from 'lucide-react';
import { ownedStateChip, type ChipTone } from '../logic/owned.js';
import type { SessionRowDto } from '../shared.js';
import { Tooltip } from '../ui/Tooltip.js';
import { Chip, type ChipVariant } from '../ui/Chip.js';

/** The shared chip variant of each tone of the owned state. */
const TONE: Record<ChipTone, ChipVariant> = { attention: 'danger', working: 'warning', warning: 'warning', muted: 'neutral' };

const TONE_ICON: Record<ChipTone, LucideIcon> = { attention: CircleAlert, working: LoaderCircle, warning: OctagonAlert, muted: CircleX };

/**
 * The owned state of a session as a chip: waiting for permission, interrupted, exited, starting (and running in the header). `compact` (the list rows) leaves
 * out the states the state icon of the row already says. `iconOnly` (the compact Tree density) keeps the icon and moves the label to the accessible name and the tooltip.
 */
export function OwnedStateChip({ session, compact = false, iconOnly = false }: { session: Pick<SessionRowDto, 'launchedBy' | 'ownedState' | 'ownedRawState' | 'registryPending' | 'pendingPermissions'> & { host?: SessionRowDto['host'] }; compact?: boolean; iconOnly?: boolean }) {
  const chip = ownedStateChip(session);
  // A list row already says that an agent needs you (the red icon, the reason under the name): its chip only says what the row cannot (several requests wait, or a background session waits in a terminal).
  if (chip === undefined || (compact && (chip.quiet || (chip.tone === 'attention' && session.host !== 'bg' && session.pendingPermissions <= 1)))) {
    return null;
  }
  const Icon = TONE_ICON[chip.tone];
  return (
    <Tooltip content={iconOnly ? `${chip.label}: ${chip.meaning}` : chip.meaning}>
      <Chip data-owned-state={session.ownedState} variant={TONE[chip.tone]} icon={<Icon className={`h-am-icon-sm w-am-icon-sm ${chip.tone === 'working' ? 'animate-spin motion-reduce:animate-none' : ''}`} />}>
        {iconOnly ? <span className="sr-only">{chip.label}</span> : chip.label}
      </Chip>
    </Tooltip>
  );
}
