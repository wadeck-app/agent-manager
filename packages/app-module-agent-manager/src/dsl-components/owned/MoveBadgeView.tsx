import { CircleCheck, TriangleAlert } from 'lucide-react';
import type { MoveBadge } from '../logic/adoptSwitch.js';
import { Tooltip } from '../ui/Tooltip.js';

/** Classes written in full: a class built at run time generates no CSS rule. */
const BADGE_LOOK: Record<MoveBadge['tone'], string> = {
  free: 'bg-hue-green-bg text-hue-green',
  busy: 'bg-warning-bg text-warning-text',
  unknown: 'bg-warning-bg text-warning-text',
};

/** What runs in the session, in words (never the colour alone); the reasons are the tooltip. The same badge next to the Move button and in the line of an agent that cannot move. */
export function MoveBadgeView({ badge }: { badge: MoveBadge }) {
  const Icon = badge.tone === 'free' ? CircleCheck : TriangleAlert;
  return (
    <Tooltip content={badge.title}>
      <span data-adopt-badge={badge.tone} tabIndex={0} className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs ${BADGE_LOOK[badge.tone]}`}>
        <Icon aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
        {badge.label}
      </span>
    </Tooltip>
  );
}
