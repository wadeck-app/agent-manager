import { memo, type ReactNode } from 'react';
import type { LogStyle } from '../deps.js';
import { ChatFrame } from './ChatFrame.js';
import { CompactFrame } from './CompactFrame.js';
import type { FrameProps } from './frameTypes.js';
import type { RowModel } from './rowModel.js';
import { TimelineFrame } from './TimelineFrame.js';

export type { FrameProps } from './frameTypes.js';

const FRAMES: Record<LogStyle, (props: FrameProps) => ReactNode> = { chat: ChatFrame, timeline: TimelineFrame, compact: CompactFrame };

/** Draws one row in the chosen style. Memoised on what changes the picture: the model is rebuilt from the entry on each render, so the entry object is the key. */
function sameFrame(a: { model: RowModel; style: LogStyle; open: boolean; now: number; highlighted: boolean; sig: unknown }, b: typeof a): boolean {
  const same = Array.isArray(a.sig) && Array.isArray(b.sig) ? a.sig.length === b.sig.length && a.sig.every((item, index) => item === (b.sig as unknown[])[index]) : a.sig === b.sig;
  return same && a.style === b.style && a.open === b.open && a.highlighted === b.highlighted && a.now === b.now;
}

export const RowFrame = memo(function RowFrame(props: FrameProps & { sig: unknown }) {
  const Frame = FRAMES[props.style];
  return <Frame {...props} />;
}, sameFrame);
