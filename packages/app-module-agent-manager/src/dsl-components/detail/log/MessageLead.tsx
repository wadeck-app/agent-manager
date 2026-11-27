import type { ReactNode } from 'react';
import type { MessageStyle } from './chatLayouts.js';
import type { RowModel } from './rowModel.js';
import { LOG_ICON } from './sizes.js';

/** The column before the text of a message, in the layouts that have one (a glyph in a box, a bare glyph, a text glyph). The gutter lead (time and name) is drawn by ChatMessage. */
export function MessageLead({ model, style, grouped }: { model: RowModel; style: MessageStyle; grouped: boolean }): ReactNode {
  const Icon = model.icon;
  switch (style.lead) {
    case 'avatar':
      return grouped ? (
        <span className="w-8 shrink-0" aria-hidden="true" />
      ) : (
        <span className={style.leadClass}>
          <Icon aria-hidden="true" className={`${LOG_ICON} ${model.iconClass}`} />
        </span>
      );
    case 'icon':
      return (
        <span className={`mt-0.5 ${style.leadClass}`}>
          <Icon aria-hidden="true" className={`${LOG_ICON} ${model.iconClass}`} />
        </span>
      );
    case 'prefix':
      return (
        <span aria-hidden="true" className={`w-3 shrink-0 select-none text-center font-mono ${style.leadClass}`}>
          {style.prefix}
        </span>
      );
    case 'none':
    case 'gutter':
      return null;
  }
}
