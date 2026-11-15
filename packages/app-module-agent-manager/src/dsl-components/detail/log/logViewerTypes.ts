import type { AgentRow, LogStyle } from '../deps.js';

export interface LogViewerProps {
  session: AgentRow;
  logStyle: LogStyle;
}
