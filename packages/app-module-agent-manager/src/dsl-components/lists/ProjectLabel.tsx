import type { AgentRow } from '../data/types.js';
import { sessionName } from './common.js';
import { Highlight } from './Highlight.js';

/**
 * Folder in bold, session name muted: the herdr reading order. Long text is cut with an ellipsis and the full text is the native title.
 * `terms` (the free words of a search) light up the letters that matched.
 */
export function ProjectLabel({ session, className = '', terms }: { session: AgentRow; className?: string; terms?: readonly string[] }) {
  const name = sessionName(session);
  return (
    <span className={`flex min-w-0 items-baseline gap-1.5 ${className}`}>
      <span className="max-w-[65%] shrink-0 truncate font-semibold text-content" title={session.folder}>
        <Highlight text={session.folder} terms={terms} />
      </span>
      {name !== '' ? (
        <span className="truncate text-muted-tint" title={name}>
          <Highlight text={name} terms={terms} />
        </span>
      ) : null}
    </span>
  );
}
