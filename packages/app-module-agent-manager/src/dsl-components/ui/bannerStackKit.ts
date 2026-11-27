import { createContext } from 'react';
import { prose } from '../logic/prose.js';
import type { BannerTone } from './Banner.js';

/** What a banner of the stack says: the tone, the text (a server text, made a sentence on display) and an optional action ("Retry"). */
export interface StackedItem {
  tone: BannerTone;
  text: string;
  actionLabel?: string | undefined;
}

export type StackSetter = (id: string, item: StackedItem | undefined, run: () => void) => void;

export interface StackView {
  items: Record<string, StackedItem>;
  open: boolean;
  toggle: () => void;
  run: (id: string) => void;
}

// Two contexts: the setter never changes (a message re-registers only when its own text changes), the view changes with every message and the toggle.
export const SetterContext = createContext<StackSetter | null>(null);
export const ViewContext = createContext<StackView | null>(null);

export const TONE_RANK: Record<BannerTone, number> = { error: 0, warning: 1, info: 2 };
/**
 * The first clause of a text, as a title: what comes before the first colon or full stop ("The socket transport cannot reach this session"). A text with no
 * colon and a single sentence is its own title (nothing to unfold).
 */
export function headlineOf(text: string): string {
  const sentence = prose(text);
  const cut = sentence.search(/[:.]\s|[:.]$/);
  return cut > 0 ? sentence.slice(0, cut) : sentence;
}
