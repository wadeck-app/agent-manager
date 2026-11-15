import type { LogStyle } from '../deps.js';
import type { OpenContext, RowModel } from './rowModel.js';

export interface FrameProps {
  model: RowModel;
  style: LogStyle;
  open: boolean;
  onToggle: (key: string) => void;
  context: OpenContext;
  now: number;
  highlighted: boolean;
}
