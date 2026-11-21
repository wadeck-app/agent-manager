import type { GroupColor } from '../shared.js';

/** The look of a group color: classes written in full (a class built at run time generates no CSS rule). The colors are the hue tokens of the theme. */
export const GROUP_LOOK: Record<GroupColor | 'none', { label: string; dot: string; text: string }> = {
  blue: { label: 'Blue', dot: 'bg-hue-blue', text: 'text-hue-blue' },
  green: { label: 'Green', dot: 'bg-hue-green', text: 'text-hue-green' },
  yellow: { label: 'Yellow', dot: 'bg-hue-yellow', text: 'text-hue-yellow' },
  orange: { label: 'Orange', dot: 'bg-hue-orange', text: 'text-hue-orange' },
  red: { label: 'Red', dot: 'bg-hue-red', text: 'text-hue-red' },
  purple: { label: 'Purple', dot: 'bg-hue-purple', text: 'text-hue-purple' },
  cyan: { label: 'Cyan', dot: 'bg-hue-cyan', text: 'text-hue-cyan' },
  gray: { label: 'Gray', dot: 'bg-muted', text: 'text-muted' },
  none: { label: 'No color', dot: 'bg-border', text: 'text-muted' },
};
