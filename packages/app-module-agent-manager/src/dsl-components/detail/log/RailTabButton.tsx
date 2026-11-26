import type { ReactNode } from 'react';
import { FOCUS_RING, Tooltip } from '../deps.js';

/** A tab of the open rail: an icon button, pressed when its panel is the one shown. */
export function RailTabButton({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip content={label} describe={false}>
      <button type="button" aria-label={label} aria-pressed={active} onClick={onClick} className={`relative inline-flex h-am-hit w-8 items-center justify-center rounded ${active ? 'bg-primary-light text-content' : 'text-muted hover:bg-muted-bg hover:text-content'} ${FOCUS_RING}`}>
        {children}
      </button>
    </Tooltip>
  );
}

