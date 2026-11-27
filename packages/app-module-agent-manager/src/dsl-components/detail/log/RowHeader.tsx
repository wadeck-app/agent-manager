import type { ReactNode } from 'react';
import { ExpandMark } from './ExpandMark.js';
import { RowButton, FOCUS_RING, Tooltip } from '../deps.js';
import { TooltipLines } from './TooltipLines.js';
import { TONE_TEXT } from './frameStyles.js';
import type { RowModel } from './rowModel.js';
import { LOG_ICON, LOG_MONO } from './sizes.js';
import { TIP_FILL } from '../deps.js';

/** The clickable title line of a row. A row with nothing to open is a static line with a faint chevron in the same slot, and its summary is shown whole (it wraps). */
export function RowHeader({ model, expandable, open, onToggle }: { model: RowModel; expandable: boolean; open: boolean; onToggle: () => void }) {
  const Icon = model.icon;
  const content: ReactNode = (
    <>
      <ExpandMark open={open} enabled={expandable} />
      <Icon aria-hidden="true" className={`${LOG_ICON} ${model.iconClass}`} />
      <span className={`shrink-0 text-sm font-medium ${TONE_TEXT[model.tone]}`}>{model.label}</span>
      {open ? <span className="flex-1" /> : <span className={`min-w-[5rem] flex-1 ${expandable ? 'truncate' : 'break-words'} ${LOG_MONO} text-muted`}>{model.summary}</span>}
      {model.trailing === undefined ? null : <span className="ml-auto inline-flex shrink-0 items-center whitespace-nowrap">{model.trailing}</span>}
    </>
  );
  // Wraps: on a narrow pane the chips and the duration drop to their own line under the title (right aligned), never over the title or the age.
  const row = 'flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-left';
  return expandable ? (
    <Tooltip className={TIP_FILL} content={model.tooltip === undefined ? undefined : <TooltipLines text={model.tooltip} />}>
      <RowButton type="button" data-tip-fill="" aria-expanded={open} onClick={onToggle} className={`${row} rounded px-1 py-0.5 hover:bg-muted-bg ${FOCUS_RING}`}>
        {content}
      </RowButton>
    </Tooltip>
  ) : (
    <div className={`${row} px-1 py-0.5`}>{content}</div>
  );
}
