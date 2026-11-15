import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { FOCUS_RING } from '../deps.js';
import { TONE_TEXT } from './frameStyles.js';
import type { RowModel } from './rowModel.js';
import { LOG_ICON, LOG_MONO } from './sizes.js';

/** The clickable (or static) title line of a row. */
export function RowHeader({ model, expandable, open, onToggle, mono }: { model: RowModel; expandable: boolean; open: boolean; onToggle: () => void; mono?: boolean }) {
  const Icon = model.icon;
  const Chevron = open ? ChevronDown : ChevronRight;
  const content: ReactNode = (
    <>
      {expandable ? <Chevron aria-hidden="true" className={`${LOG_ICON} text-muted`} /> : null}
      <Icon aria-hidden="true" className={`${LOG_ICON} ${model.iconClass}`} />
      <span className={`shrink-0 ${mono === true ? LOG_MONO : 'text-sm'} font-medium ${TONE_TEXT[model.tone]}`}>{model.label}</span>
      {open && !mono ? <span className="flex-1" /> : <span className={`min-w-0 flex-1 truncate ${LOG_MONO} text-muted`}>{model.summary}</span>}
      {model.trailing}
    </>
  );
  const row = 'flex w-full min-w-0 items-center gap-2 text-left';
  return expandable ? (
    <button type="button" aria-expanded={open} onClick={onToggle} className={`${row} rounded px-1 py-0.5 hover:bg-muted-bg ${FOCUS_RING}`}>
      {content}
    </button>
  ) : (
    <div className={`${row} px-1 py-0.5`}>{content}</div>
  );
}
