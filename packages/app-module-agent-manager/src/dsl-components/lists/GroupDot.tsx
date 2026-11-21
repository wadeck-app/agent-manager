import type { GroupColor } from '../shared.js';
import { GROUP_LOOK } from '../ui/groupLook.js';

/** The color of a group as a small round mark; the color name is the text alternative (colour is never the only signal: the group name sits next to it). */
export function GroupDot({ color }: { color: GroupColor | null }) {
  const look = GROUP_LOOK[color ?? 'none'];
  return (
    <span role="img" aria-label={look.label} className={`inline-block h-am-dot w-am-dot shrink-0 rounded-full ${look.dot}`} />
  );
}
