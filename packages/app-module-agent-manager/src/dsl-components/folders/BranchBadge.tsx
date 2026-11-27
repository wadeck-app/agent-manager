import { Tooltip } from '@wadeck-app/dsl-ui';
import { GitBranch } from 'lucide-react';

const BRANCH_BADGE = 'inline-flex max-w-[12rem] shrink-0 items-center gap-1 rounded border border-border px-1 text-xs text-muted';

/** The branch of a repository, in a badge: the icon and the text, never a colour alone. */
export function BranchBadge({ branch }: { branch: string | undefined }) {
  if (branch === undefined) {
    return null;
  }
  return (
    <Tooltip content={`Branch ${branch}`}>
      <span className={BRANCH_BADGE}>
        <GitBranch aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0" />
        <span className="truncate">{branch}</span>
      </span>
    </Tooltip>
  );
}
