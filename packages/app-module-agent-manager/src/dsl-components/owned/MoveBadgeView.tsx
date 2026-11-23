import { CircleCheck, TriangleAlert } from 'lucide-react';
import type { MoveBadge } from '../logic/adoptSwitch.js';
import { Chip, type ChipVariant } from '../ui/Chip.js';
import { Tooltip } from '../ui/Tooltip.js';

const BADGE_VARIANT: Record<MoveBadge['tone'], ChipVariant> = { free: 'success', busy: 'warning', unknown: 'warning' };

/** What runs in the session, in words (never the colour alone); the reasons are the tooltip. The same badge next to the Move button and in the line of an agent that cannot move. */
export function MoveBadgeView({ badge }: { badge: MoveBadge }) {
  const Icon = badge.tone === 'free' ? CircleCheck : TriangleAlert;
  return (
    <Tooltip content={badge.title}>
      <Chip data-adopt-badge={badge.tone} tabIndex={0} variant={BADGE_VARIANT[badge.tone]} icon={<Icon className="h-am-icon-sm w-am-icon-sm" />}>
        {badge.label}
      </Chip>
    </Tooltip>
  );
}
