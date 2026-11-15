import type { AgentRow } from '../data/types.js';

/** What every list variant receives. */
export interface ListProps {
  sessions: AgentRow[];
  selectedId: string | undefined;
  onSelect: (sessionId: string) => void;
  now: number;
  /** The sub-variant (see LIST_STYLES). */
  style: string;
}

/** The session name when it adds something to the folder (the registry name, not the folder echoed back). */
export function sessionName(session: AgentRow): string {
  return session.displayName === session.folder ? '' : session.displayName;
}

/** The second line of a row: why it needs you, what it is doing, or what it finished. Empty when there is nothing true to say. */
export function detailLine(session: AgentRow): string {
  switch (session.state) {
    case 'needs-you':
      return session.reason !== '' ? session.reason : 'Waiting for you';
    case 'done':
      return session.lastActivity !== '' ? `Finished: ${session.lastActivity}` : 'Finished, not seen yet';
    case 'ended':
      return 'The process is gone';
    case 'other':
      return `Status: ${session.status}`;
    case 'working':
    case 'idle':
      return session.lastActivity;
    default:
      throw new Error(`detailLine: unhandled state ${String(session.state)}`);
  }
}
