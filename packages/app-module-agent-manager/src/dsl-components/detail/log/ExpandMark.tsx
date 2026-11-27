import { ChevronDown, ChevronRight } from 'lucide-react';
import { LOG_ICON } from './sizes.js';

/**
 * The expand chevron of a log row, always drawn so the icons and the text of every row line up. `enabled`: the row opens (right when closed, down when open).
 * Not enabled: there is nothing to open that the line does not already say; the same slot holds a faint right chevron. It is a plain decorative icon (aria-hidden)
 * inside a row that is not a button: no hover, no pointer, no tab stop, no click.
 */
export function ExpandMark({ open, enabled }: { open: boolean; enabled: boolean }) {
  if (!enabled) {
    return <ChevronRight aria-hidden="true" data-expand-mark="off" className={`${LOG_ICON} cursor-default text-muted opacity-30`} />;
  }
  const Chevron = open ? ChevronDown : ChevronRight;
  return <Chevron aria-hidden="true" data-expand-mark={open ? 'open' : 'closed'} className={`${LOG_ICON} text-muted`} />;
}
