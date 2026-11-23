import { chipClass, FOCUS_RING } from '../deps.js';

/** One look for every chip of the status row: the shared neutral chip, focusable so its tooltip also opens from the keyboard. */
export const CHIP = `${chipClass('neutral')} ${FOCUS_RING}`;
/** A chip that says something is wrong or uncertain. */
export const CHIP_WARNING = `${chipClass('warning')} ${FOCUS_RING}`;
export const CHIP_ICON = 'h-am-icon-sm w-am-icon-sm shrink-0';
