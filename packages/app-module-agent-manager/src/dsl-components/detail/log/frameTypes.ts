import type { OpenContext, RowModel } from './rowModel.js';

export interface FrameProps {
  model: RowModel;
  open: boolean;
  onToggle: (key: string) => void;
  context: OpenContext;
  now: number;
  highlighted: boolean;
}
