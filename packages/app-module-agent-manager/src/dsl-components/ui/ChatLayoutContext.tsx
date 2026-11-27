import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { DEFAULT_CHAT_LAYOUT, type ChatLayoutVariant } from '../logic/chatLayoutPref.js';

interface ChatLayoutControl {
  layout: ChatLayoutVariant;
  setLayout: (next: ChatLayoutVariant) => void;
}

// Without a provider (a test, a component used alone) the layout is the default and changing it fails loudly: a control that edits nothing must not look as if it worked.
const NO_PROVIDER: ChatLayoutControl = {
  layout: DEFAULT_CHAT_LAYOUT,
  setLayout: () => {
    throw new Error('The chat layout cannot be changed here: no ChatLayoutProvider above this control (the Workspace page provides one).');
  },
};

const Context = createContext<ChatLayoutControl>(NO_PROVIDER);

/** The layout of the messages of the log (logic/chatLayoutPref.ts). The one source of truth: the log, the list menu and the log filter popup all read it here. */
export function useChatLayout(): ChatLayoutVariant {
  return useContext(Context).layout;
}

/** The layout and its setter, for the controls that edit it. */
export function useChatLayoutControl(): ChatLayoutControl {
  return useContext(Context);
}

export function ChatLayoutProvider({ layout, setLayout, children }: { layout: ChatLayoutVariant; setLayout: (next: ChatLayoutVariant) => void; children: ReactNode }) {
  const value = useMemo(() => ({ layout, setLayout }), [layout, setLayout]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
