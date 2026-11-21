import { FOCUS_RING } from '../ui/IconButton.js';

/** The scrolling box every picker draws its list in: a fixed height, so that switching variants (or opening a folder) never moves the rest of the dialog. */
export const PICKER_PANEL = 'h-72 overflow-auto rounded border border-border bg-surface';

/** A row of a list: one geometry for every variant (the height follows the density setting). */
export const PICKER_ROW = `flex min-h-am-row w-full items-center gap-1.5 px-2 py-0.5 text-left text-sm text-content hover:bg-muted-bg ${FOCUS_RING}`;
export const PICKER_ROW_SELECTED = 'bg-primary-light';
