import { Circle, CircleAlert, CircleDot, CircleHelp, CircleOff, LoaderCircle, Pin, type LucideIcon } from 'lucide-react';
import type { ChipVariant } from './Chip.js';
import { STATE_LABEL, type AgentState, type GroupId } from '../logic/states.js';

/**
 * How a state looks. Colour only through the semantic tokens of dsl-ui (hue tokens where the colour is the meaning); the shape differs per state too
 * (herdr's `status_indicators = "symbols"` idea: colour is never the only signal). Tailwind classes are written in full: a class built at run time
 * generates no CSS rule.
 */
export interface StateLook {
  label: string;
  icon: LucideIcon;
  /** Icon colour, also the colour of a group heading. */
  text: string;
  /** Background of a pill or a badge of this state. */
  bg: string;
  /** Extra classes of the icon (the spinner of Working). */
  iconClass: string;
}

export const STATE_LOOK: Record<AgentState, StateLook> = {
  'needs-you': { label: STATE_LABEL['needs-you'], icon: CircleAlert, text: 'text-hue-red', bg: 'bg-hue-red-bg', iconClass: '' },
  done: { label: STATE_LABEL.done, icon: CircleDot, text: 'text-hue-blue', bg: 'bg-hue-blue-bg', iconClass: '' },
  working: { label: STATE_LABEL.working, icon: LoaderCircle, text: 'text-hue-yellow', bg: 'bg-hue-yellow-bg', iconClass: 'animate-spin motion-reduce:animate-none' },
  idle: { label: STATE_LABEL.idle, icon: Circle, text: 'text-muted-tint', bg: 'bg-muted-bg', iconClass: '' },
  other: { label: STATE_LABEL.other, icon: CircleHelp, text: 'text-hue-orange', bg: 'bg-hue-orange-bg', iconClass: '' },
  ended: { label: STATE_LABEL.ended, icon: CircleOff, text: 'text-muted-tint', bg: 'bg-muted-bg', iconClass: '' },
};

/** The chip variant of each state: the shared chip has five looks, so the two warm states (working, other) share the warning one (the icon and the word differ). */
export const STATE_VARIANT: Record<AgentState, ChipVariant> = { 'needs-you': 'danger', done: 'info', working: 'warning', idle: 'neutral', other: 'warning', ended: 'neutral' };

/** The heading colour of a group: the state colour, neutral for Pinned. */
export function groupText(id: GroupId): string {
  return id === 'pinned' ? 'text-muted' : STATE_LOOK[id].text;
}

export const PIN_ICON = Pin;
