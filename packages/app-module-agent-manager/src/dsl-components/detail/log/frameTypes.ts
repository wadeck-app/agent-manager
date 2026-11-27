import type { ThreadAnchor } from '../deps.js';
import type { OpenContext, RowModel } from './rowModel.js';

export interface FrameProps {
  model: RowModel;
  open: boolean;
  onToggle: (key: string) => void;
  context: OpenContext;
  now: number;
  highlighted: boolean;
  /** Opens the Thread dialog on a message row. Stable across renders (the memoised frames do not compare it). Absent: no Thread action. */
  onThread?: (anchor: Extract<ThreadAnchor, { kind: 'ok' }>) => void;
}
