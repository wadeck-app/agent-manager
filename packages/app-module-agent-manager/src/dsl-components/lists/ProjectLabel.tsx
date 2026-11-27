import { Folder } from 'lucide-react';
import type { AgentRow } from '../data/types.js';
import { useUiVariant } from '../ui/UiVariants.js';
import { sessionName } from './common.js';
import { Highlight } from './Highlight.js';
import { InlineSecondary, isStacked } from './RowSecondary.js';
import { RowTip } from './RowTip.js';

/**
 * Folder in bold, session name muted: the herdr reading order. Long text is cut with an ellipsis and the full text is in the tooltip. What separates the two is
 * the A/B question `ui-row-separator` (colour and gap, a rule, a chip, a folder icon, or two lines).
 * `terms` (the free words of a search) light up the letters that matched.
 */
export function ProjectLabel({ session, className = '', terms, line = '' }: { session: AgentRow; className?: string; terms?: readonly string[]; line?: string }) {
  const name = sessionName(session);
  const variant = useUiVariant('rowSeparator');
  if (variant === 'stacked') {
    return (
      <RowTip session={session} line={line}>
        <span data-tip-fill="" data-herdr-stack="" className={`flex min-w-0 flex-col ${className}`}>
          <span className="min-w-0 max-w-full truncate font-semibold leading-4 text-content">
            <Highlight text={session.folder} terms={terms} />
          </span>
          {name !== '' ? (
            <span className="min-w-0 max-w-full truncate text-[11px] leading-4 text-muted-tint">
              <span className="sr-only">, </span>
              <Highlight text={name} terms={terms} />
            </span>
          ) : null}
        </span>
      </RowTip>
    );
  }
  return (
    <RowTip session={session} line={line}>
      <span data-tip-fill="" className={`flex min-w-0 items-center gap-2 ${className}`}>
        {/* Here the folder is the first text and the session name the secondary one: the folder icon (variant D) goes before the folder, the name is plain muted text. */}
        {variant === 'folder' ? <Folder aria-hidden="true" data-row-folder-icon="" className="-mr-1 h-3 w-3 shrink-0 text-muted-tint" /> : null}
        <span className="max-w-[65%] shrink-0 truncate font-semibold text-content">
          <Highlight text={session.folder} terms={terms} />
        </span>
        {name !== '' ? (
          <InlineSecondary variant={variant === 'folder' ? 'space' : variant} textClass="">
            <Highlight text={name} terms={terms} />
          </InlineSecondary>
        ) : null}
      </span>
    </RowTip>
  );
}
