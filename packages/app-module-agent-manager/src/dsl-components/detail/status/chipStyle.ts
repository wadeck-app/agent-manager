import { FOCUS_RING } from '../deps.js';

/** One look for every chip of the status row: a quiet pill, focusable so its tooltip also opens from the keyboard. */
export const CHIP = `inline-flex items-center gap-1 rounded bg-muted-bg px-1.5 py-0.5 text-xs text-content ${FOCUS_RING}`;
/** A chip that says something is wrong or uncertain. */
export const CHIP_WARNING = `inline-flex items-center gap-1 rounded border border-warning bg-warning-bg px-1.5 py-0.5 text-xs text-warning-text ${FOCUS_RING}`;
export const CHIP_ICON = 'h-am-icon-sm w-am-icon-sm shrink-0';
