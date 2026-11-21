import { CircleAlert, CircleX, LoaderCircle, OctagonAlert, type LucideIcon } from 'lucide-react';
import { ownedStateChip, type ChipTone } from '../logic/owned.js';
import type { SessionRowDto } from '../shared.js';
import { Tooltip } from '../ui/Tooltip.js';
import { CHIP } from './OwnedChips.js';

/** Classes are written in full: a class built at run time generates no CSS rule. */
const TONE: Record<ChipTone, string> = {
  attention: 'bg-hue-red-bg text-hue-red',
  working: 'bg-hue-yellow-bg text-hue-yellow',
  warning: 'bg-warning-bg text-warning-text',
  muted: 'bg-muted-bg text-muted',
};

const TONE_ICON: Record<ChipTone, LucideIcon> = { attention: CircleAlert, working: LoaderCircle, warning: OctagonAlert, muted: CircleX };

/**
 * The owned state of a session as a chip: waiting for permission, interrupted, exited, starting (and running in the header). `compact` (the list rows) leaves
 * out the states the state icon of the row already says.
 */
export function OwnedStateChip({ session, compact = false }: { session: Pick<SessionRowDto, 'launchedBy' | 'ownedState' | 'ownedRawState' | 'registryPending' | 'pendingPermissions'> & { host?: SessionRowDto['host'] }; compact?: boolean }) {
  const chip = ownedStateChip(session);
  if (chip === undefined || (compact && chip.quiet)) {
    return null;
  }
  const Icon = TONE_ICON[chip.tone];
  return (
    <Tooltip content={chip.meaning}>
      <span data-owned-state={session.ownedState} className={`${CHIP} ${TONE[chip.tone]}`}>
        <Icon aria-hidden="true" className={`h-am-icon-sm w-am-icon-sm ${chip.tone === 'working' ? 'animate-spin motion-reduce:animate-none' : ''}`} />
        {chip.label}
      </span>
    </Tooltip>
  );
}
