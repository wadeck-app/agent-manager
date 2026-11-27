import type { AgentRow } from '../data/types.js';
import { sessionName } from './common.js';
import { isQuietRow, nameClasses } from '../logic/rowLook.js';
import { Highlight } from './Highlight.js';
import { useRowLook } from './RowLookContext.js';
import { InlineSecondary } from './RowSecondary.js';
import { RowTip } from './RowTip.js';

/**
 * Folder in bold, session name muted: the herdr reading order. Long text is cut with an ellipsis and the full text is in the tooltip. The two are separated by
 * colour and a gap only (lists/RowSecondary.tsx).
 * `terms` (the free words of a search) light up the letters that matched.
 */
export function ProjectLabel({ session, selected, className = '', terms, line = '' }: { session: AgentRow; selected: boolean; className?: string; terms?: readonly string[]; line?: string }) {
  const strong = nameClasses(useRowLook(), selected, isQuietRow(session, selected), 'strong');
  const name = sessionName(session);
  return (
    <RowTip session={session} line={line}>
      <span data-tip-fill="" className={`flex min-w-0 items-center gap-2 ${className}`}>
        <span className={`max-w-[65%] shrink-0 truncate ${strong}`}>
          <Highlight text={session.folder} terms={terms} />
        </span>
        {name !== '' ? (
          <InlineSecondary textClass="">
            <Highlight text={name} terms={terms} />
          </InlineSecondary>
        ) : null}
      </span>
    </RowTip>
  );
}
