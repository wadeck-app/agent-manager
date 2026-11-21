import type { AgentRow, OwnedSessionDto } from '../deps.js';

export interface LogViewerProps {
  session: AgentRow;
  /** The daemon started a thread from a message of this log: the page lists and selects it. Absent: the rows have no Thread action. */
  onThreadStarted?: (session: OwnedSessionDto) => void;
  /** The transcript uuid of a message to bring into view (the link back from a thread): its row pulses once the log holds it. */
  focusMessageId?: string;
}
