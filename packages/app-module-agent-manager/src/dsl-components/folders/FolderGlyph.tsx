import { Folder, FolderGit2, Link2 } from 'lucide-react';
import type { FolderEntryDto } from '../shared.js';

/** The icon of a folder: a repository is told from a plain folder by its shape, not by a colour alone. */
export function FolderGlyph({ entry }: { entry: Pick<FolderEntryDto, 'hasGit' | 'isLink'> }) {
  const Icon = entry.hasGit ? FolderGit2 : entry.isLink ? Link2 : Folder;
  return <Icon aria-hidden="true" className={`h-am-icon-sm w-am-icon-sm shrink-0 ${entry.hasGit ? 'text-primary' : 'text-muted'}`} />;
}
