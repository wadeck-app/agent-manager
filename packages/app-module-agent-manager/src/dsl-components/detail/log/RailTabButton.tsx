import { IconButton } from '@wadeck-app/dsl-ui';
import type { ReactNode } from 'react';

/** The look of a tab of the open rail: the tint of the pressed one, the quiet ghost otherwise (the base IconButton owns size, focus ring and tooltip). */
const ACTIVE_TAB = 'relative bg-primary-light text-content';
const IDLE_TAB = 'relative';

/** A tab of the open rail: an icon button, pressed when its panel is the one shown. */
export function RailTabButton({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return <IconButton aria-label={label} aria-pressed={active} onClick={onClick} className={active ? ACTIVE_TAB : IDLE_TAB} icon={children} />;
}
