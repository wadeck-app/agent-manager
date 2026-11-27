import type { ReactNode } from 'react';
import type { MessageStyle } from './chatLayouts.js';

/** The column before the text of a message, in the layouts that have one (the terminal: a text glyph for the sender). */
export function MessageLead({ style }: { style: MessageStyle }): ReactNode {
  if (style.lead !== 'prefix') {
    return null;
  }
  return (
    <span aria-hidden="true" className={`w-3 shrink-0 select-none text-center font-mono ${style.leadClass}`}>
      {style.prefix}
    </span>
  );
}
