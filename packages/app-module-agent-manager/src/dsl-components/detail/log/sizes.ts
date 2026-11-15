/** One source for the sizes of the log: icons and text of every style use these, so a change is one edit. */
export const LOG_ICON = 'h-am-icon-sm w-am-icon-sm shrink-0';
export const LOG_ICON_SM = 'h-am-icon-sm w-am-icon-sm shrink-0';
export const LOG_TEXT = 'text-sm leading-am-log';
export const LOG_META = 'text-xs';
export const LOG_MONO = 'font-mono text-am-mono';
/** Output of a tool call shown at first, before "Show more". */
export const OUTPUT_CAP_CHARS = 1200;
export const OUTPUT_CAP_LINES = 14;
/** Distance (px) from the bottom under which the user counts as "at the bottom". */
export const BOTTOM_SLACK_PX = 24;
/** Distance (px) from the top under which older entries are loaded while scrolling up. */
export const TOP_LOAD_PX = 80;
/** Entries per answer. */
export const PAGE_LIMIT = 100;
/** Entries per page while searching back for a call (the largest the route allows): fewer requests. */
export const LOCATE_PAGE_LIMIT = 500;
/** Most pages one search for a call loads before it stops and offers to go on (about 20 000 entries). */
export const LOCATE_MAX_PAGES = 40;
export const POLL_MS = 2000;
