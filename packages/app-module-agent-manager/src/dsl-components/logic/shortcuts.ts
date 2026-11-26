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
  { keys: ['m'], text: 'Tree: move the focused agent to a group (a dialog lists the groups; drag and drop does the same)' },
  { keys: ['e'], text: 'Tree: edit the focused group (name, color, order, delete)' },
  { keys: ['Alt+Up', 'Alt+Down'], text: 'Tree: move the focused agent inside its group, or the focused group among the groups' },
  { keys: ['Shift+F10'], text: 'Open the action menu of the focused agent (move, flag, pin, mark seen): the same menu as its "..." button, the context-menu key and a right click' },
  { keys: ['x'], text: 'Tick or untick the focused agent for a batch action: turns the selection mode on (Shift click ticks a range, Ctrl or Cmd click toggles one)' },
  { keys: ['Esc'], text: 'Leave a text field; leave the selection mode and clear the ticked agents; with the mode off and no field focused, close the selected agent' },
  { keys: ['?'], text: 'Show or hide this help' },
];
