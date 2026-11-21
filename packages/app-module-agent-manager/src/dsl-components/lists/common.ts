import type { AgentRow } from '../data/types.js';
import type { CustomGroupDto, GroupColor } from '../shared.js';
import type { ParsedQuery } from '../logic/fuzzy.js';
import type { ViewOptions } from '../logic/viewOptions.js';

/** What every list mode receives. The rows are already filtered by the search: a list only draws what it is given. */
export interface ListProps {
  sessions: AgentRow[];
  selectedId: string | undefined;
  onSelect: (sessionId: string) => void;
  now: number;
  /** The parsed search (its free words light up the letters that matched); an empty query when nothing is typed. */
  query: ParsedQuery;
  /** The search is active: the empty states say "no match" instead of "no session". */
  searching: boolean;
  options: ViewOptions;
  /** The custom groups (Tree list only); absent where the list has none (the other modes, tests). */
  groups?: GroupsApi;
}

/** What the Tree list needs to show and change the custom groups (the page owns the data and the requests). */
export interface GroupsApi {
  /** The groups in display order, with the page's local changes applied. */
  groups: CustomGroupDto[];
  /** Moves a session into a group (before the member `beforeId`, or at the end) or out of its group (`groupId` null). */
  move: (sessionId: string, groupId: string | null, beforeId?: string | null) => void;
  /** Creates a group at the end; resolves with it, or undefined when the server refused (the page shows why). */
  create: (name: string, color?: GroupColor | null) => Promise<CustomGroupDto | undefined>;
  update: (id: string, patch: { name?: string; color?: GroupColor | null; collapsed?: boolean }) => void;
  remove: (id: string) => void;
  /** Sets the order of the groups: every group id, once. */
  reorder: (ids: string[]) => void;
}

/** The session name when it adds something to the folder (the registry name, not the folder echoed back). */
export function sessionName(session: AgentRow): string {
  return session.displayName === session.folder ? '' : session.displayName;
}

/** The second line of a row: why it needs you, what it is doing, or what it finished. Empty when there is nothing true to say. */
export function detailLine(session: AgentRow): string {
  // A launched session whose registry file does not exist yet: nothing was said, and the row says so (the transcript starts with the first message).
  if (session.registryPending === true && session.lastActivity === '' && (session.state === 'idle' || session.state === 'working')) {
    return 'Starting... no transcript yet';
  }
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
