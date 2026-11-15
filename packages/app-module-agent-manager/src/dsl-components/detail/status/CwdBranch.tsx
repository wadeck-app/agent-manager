import { Folder, GitBranch, TriangleAlert } from 'lucide-react';
import { CopyButton } from '../log/CopyButton.js';

/** The full working directory and its branch as the status line writes them (path::branch), with a copy button; a branch error is a visible warning. */
export function CwdBranch({ cwd, branch, branchError }: { cwd: string; branch: string | undefined; branchError: string | undefined }) {
  const copy = branch === undefined ? cwd : `${cwd}::${branch}`;
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
      <Folder aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0" />
      <span className="truncate" title={cwd}>
        {cwd}
      </span>
      {branch === undefined ? null : (
        <span className="inline-flex shrink-0 items-center gap-0.5 text-content" title={`Git branch ${branch}`}>
          <GitBranch aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
          <span className="sr-only">branch </span>
          {branch}
        </span>
      )}
      {branchError === undefined ? null : (
        <span role="alert" className="inline-flex shrink-0 items-center gap-0.5 text-warning-text" title={branchError}>
          <TriangleAlert aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
          Branch unknown: {branchError}
        </span>
      )}
      <CopyButton text={copy} label={branch === undefined ? 'Copy the working directory' : 'Copy the working directory and branch'} />
    </span>
  );
}
