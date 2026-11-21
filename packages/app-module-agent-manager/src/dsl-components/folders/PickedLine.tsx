import { FolderGit2, GitBranch } from 'lucide-react';
import { samePath, type FolderPick } from '../logic/folderPicker.js';

/** The name, and the branch when it is known, of the folder the Folder field holds: what the user is about to launch in. Nothing for a path typed by hand. */
export function PickedLine({ picked, value }: { picked: FolderPick | undefined; value: string }) {
  if (picked === undefined || !samePath(picked.path, value)) {
    return null;
  }
  return (
    <p data-picked-folder="" className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
      <FolderGit2 aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0" />
      <span className="truncate font-medium text-content">{picked.name}</span>
      {picked.branch === undefined ? (
        picked.hasGit === true ? (
          <span>git repository</span>
        ) : null
      ) : (
        <span className="inline-flex shrink-0 items-center gap-1">
          <GitBranch aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
          {picked.branch}
        </span>
      )}
    </p>
  );
}
