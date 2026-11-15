/** The page-level keyboard shortcuts: one source for the handler's documentation, the help popover and the tests. They only act when no text field has the focus. */
export interface Shortcut {
  keys: readonly string[];
  /** What it does, in the words of the help popover. */
  text: string;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { keys: ['j', 'k'], text: 'Next and previous agent (the arrow keys work in the list)' },
  { keys: ['Enter'], text: 'Open the reply box of the selected agent' },
  { keys: ['r'], text: 'Reply: focus the reply box' },
  { keys: ['/'], text: 'Search the agents (name, folder, path, last activity; state:done, project:shop)' },
  { keys: ['p'], text: 'Pin or unpin the selected agent' },
  { keys: ['Esc'], text: 'Leave a text field; with no field focused, close the selected agent' },
  { keys: ['?'], text: 'Show or hide this help' },
];
