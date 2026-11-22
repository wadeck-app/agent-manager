import { CircleAlert, CircleX, LoaderCircle, OctagonAlert, type LucideIcon } from 'lucide-react';
import { ownedStateChip, type ChipTone } from '../logic/owned.js';
import type { SessionRowDto } from '../shared.js';
import { Tooltip } from '../ui/Tooltip.js';
import { CHIP } from './OwnedChips.js';

/** Classes are written in full: a class built at run time generates no CSS rule. */
const TONE: Record<ChipTone, { bg: string; text: string }> = {
  attention: { bg: 'bg-hue-red-bg', text: 'text-hue-red' },
  working: { bg: 'bg-hue-yellow-bg', text: 'text-hue-yellow' },
  warning: { bg: 'bg-warning-bg', text: 'text-warning-text' },
  muted: { bg: 'bg-muted-bg', text: 'text-muted' },
};

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
  const tone = TONE[chip.tone];
  return (
    <Tooltip content={iconOnly ? `${chip.label}: ${chip.meaning}` : chip.meaning}>
      <span data-owned-state={session.ownedState} className={`${CHIP} ${tone.bg} ${tone.text}`}>
        <Icon aria-hidden="true" className={`h-am-icon-sm w-am-icon-sm ${chip.tone === 'working' ? 'animate-spin motion-reduce:animate-none' : ''}`} />
        {iconOnly ? <span className="sr-only">{chip.label}</span> : chip.label}
      </span>
    </Tooltip>
  );
}
