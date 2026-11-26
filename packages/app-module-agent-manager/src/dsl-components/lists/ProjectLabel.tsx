import type { AgentRow } from '../data/types.js';
import { sessionName } from './common.js';
import { Highlight } from './Highlight.js';
import { RowTip } from './RowTip.js';

/**
 * Folder in bold, session name muted: the herdr reading order. Long text is cut with an ellipsis and the full text is in the tooltip.
 * `terms` (the free words of a search) light up the letters that matched.
 */
export function ProjectLabel({ session, className = '', terms, line = '' }: { session: AgentRow; className?: string; terms?: readonly string[]; line?: string }) {
  const name = sessionName(session);
  return (
    <RowTip session={session} line={line}>
      <span data-tip-fill="" className={`flex min-w-0 items-baseline gap-1.5 ${className}`}>
        <span className="max-w-[65%] shrink-0 truncate font-semibold text-content">
          <Highlight text={session.folder} terms={terms} />
        </span>
        {name !== '' ? (
          <span className="truncate text-muted-tint">
            <Highlight text={name} terms={terms} />
          </span>
        ) : null}
      </span>
    </RowTip>
  );
}
