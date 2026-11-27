import { memo } from 'react';
import { ChatFrame } from './ChatFrame.js';
import type { FrameProps } from './frameTypes.js';
import type { RowModel } from './rowModel.js';

export type { FrameProps } from './frameTypes.js';

/** Draws one row. Memoised on what changes the picture: the model is rebuilt from the entry on each render, so the entry object is the key. */
function sameFrame(a: { model: RowModel; open: boolean; now: number; highlighted: boolean; continued?: boolean; sig: unknown }, b: typeof a): boolean {
  const same = Array.isArray(a.sig) && Array.isArray(b.sig) ? a.sig.length === b.sig.length && a.sig.every((item, index) => item === (b.sig as unknown[])[index]) : a.sig === b.sig;
  return same && a.continued === b.continued && a.open === b.open && a.highlighted === b.highlighted && a.now === b.now;
}

export const RowFrame = memo(function RowFrame(props: FrameProps & { sig: unknown }) {
  return <ChatFrame {...props} />;
}, sameFrame);
