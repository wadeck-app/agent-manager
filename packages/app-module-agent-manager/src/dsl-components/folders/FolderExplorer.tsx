import { ArrowUp, ChevronRight, HardDrive } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useFolderLists, useFolderRoots } from '../data/useFolders.js';
import { folderName, pickOf, samePath, type FolderPick } from '../logic/folderPicker.js';
import type { FolderEntryDto } from '../shared.js';
import { FOCUS_RING, ICON_BUTTON_CLASS, IconButton } from '../ui/IconButton.js';
import { BranchBadge } from './BranchBadge.js';
import { EmptyLine } from './EmptyLine.js';
import { FailedLine } from './FailedLine.js';
import { FolderGlyph } from './FolderGlyph.js';
import { LoadingLine } from './LoadingLine.js';
import { RootsNote } from './RootsNote.js';
import { TruncatedLine } from './TruncatedLine.js';
import { PICKER_PANEL, PICKER_ROW, PICKER_ROW_SELECTED } from './folderParts.js';

export interface ExplorerProps {
  value: string;
  onPick: (pick: FolderPick) => void;
  disabled: boolean;
}

/**
 * V4, the explorer: a path bar (click a segment to go back to it), an Up button, a switch between the roots, and one list of the subfolders of the folder you are in.
 * A click picks a folder; opening it (the arrow at the right of the row, a double click, Enter or Right) goes into it and picks it too, so the Folder field is always
 * the last folder you pointed at. Left or Backspace goes up, Space picks without opening, Up and Down walk the list.
 */
export function FolderExplorer({ value, onPick, disabled }: ExplorerProps) {
  const roots = useFolderRoots();
  const { lists, ensure, reload } = useFolderLists();
  const [dir, setDir] = useState<string | undefined>(undefined);
  const box = useRef<HTMLUListElement>(null);
  const rootsId = useId();

  // The first root is where the explorer starts.
  const firstRoot = roots.state.status === 'ready' ? roots.state.value.roots[0]?.path : undefined;
  useEffect(() => {
    if (dir === undefined && firstRoot !== undefined) {
      setDir(firstRoot);
      ensure(firstRoot);
    }
  }, [dir, firstRoot, ensure]);

  const go = (path: string): void => {
    setDir(path);
    ensure(path);
  };

  const enter = (entry: FolderEntryDto): void => {
    onPick(pickOf(entry));
    go(entry.path);
  };

  const list = dir === undefined ? undefined : lists[dir];
  const here = list?.status === 'ready' ? list.value : undefined;
  const rootList = roots.state.status === 'ready' ? roots.state.value.roots : [];
  // The root the current folder is under: the first crumb of its listing.
  const currentRoot = here?.breadcrumbs[0]?.path ?? rootList.find((root) => dir !== undefined && samePath(root.path, dir))?.path ?? '';

  const rows = (): HTMLElement[] => Array.from(box.current?.querySelectorAll<HTMLElement>('[data-explorer-row]') ?? []);

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    const all = rows();
    const at = all.findIndex((row) => row === document.activeElement);
    const entry = here?.entries[at];
    if (at < 0 || entry === undefined) {
      return;
    }
    const up = (): void => {
      if (here?.parent !== null && here?.parent !== undefined) {
        go(here.parent);
      }
    };
    const actions: Record<string, () => void> = {
      ArrowDown: () => all[Math.min(at + 1, all.length - 1)]?.focus(),
      ArrowUp: () => all[Math.max(at - 1, 0)]?.focus(),
      Home: () => all[0]?.focus(),
      End: () => all[all.length - 1]?.focus(),
      Enter: () => enter(entry),
      ArrowRight: () => enter(entry),
      ' ': () => onPick(pickOf(entry)),
      ArrowLeft: up,
      Backspace: up,
    };
    const action = actions[event.key];
    if (action === undefined) {
      return;
    }
    action();
    event.preventDefault();
  };

  return (
    <div className="flex flex-col gap-1.5" data-folder-picker="explorer">
      <RootsNote note={roots.state.status === 'ready' ? roots.state.value.note : ''} />
      <div className="flex items-center gap-1">
        <IconButton
          icon={ArrowUp}
          label="Up one folder"
          disabled={disabled || here === undefined || here.parent === null}
          disabledReason={here === undefined ? 'no folder is open' : 'this is a root: the list cannot go above it'}
          onClick={() => (here?.parent === null || here === undefined ? undefined : go(here.parent))}
        />
        {rootList.length > 1 ? (
          <>
            <label htmlFor={rootsId} className="sr-only">
              Root folder
            </label>
            <HardDrive aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0 text-muted" />
            <select
              id={rootsId}
              value={currentRoot}
              disabled={disabled}
              onChange={(event) => go(event.target.value)}
              className={`max-w-[14rem] rounded border border-border bg-surface px-1.5 py-1 text-sm text-content ${FOCUS_RING}`}
            >
              {currentRoot === '' || rootList.some((root) => samePath(root.path, currentRoot)) ? null : <option value={currentRoot}>{currentRoot}</option>}
              {rootList.map((root) => (
                <option key={root.path} value={root.path}>
                  {root.path}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <nav aria-label="Path" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded border border-border bg-surface px-1.5 py-0.5">
          {here === undefined ? <span className="py-0.5 text-sm text-muted">{dir === undefined ? 'No folder open' : dir}</span> : null}
          {here?.breadcrumbs.map((crumb, index) => {
            const last = index === here.breadcrumbs.length - 1;
            return (
              <span key={crumb.path} className="flex shrink-0 items-center gap-0.5">
                {index > 0 ? <ChevronRight aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0 text-muted" /> : null}
                <button
                  type="button"
                  disabled={disabled}
                  aria-current={last ? 'page' : undefined}
                  title={crumb.path}
                  onClick={() => {
                    onPick({ path: crumb.path, name: index === 0 ? here.breadcrumbs[0]!.name : crumb.name });
                    go(crumb.path);
                  }}
                  className={`rounded px-1 py-0.5 text-sm hover:bg-muted-bg ${last ? 'font-medium text-content' : 'text-muted'} ${FOCUS_RING}`}
                >
                  {index === 0 ? folderName(crumb.path) : crumb.name}
                </button>
              </span>
            );
          })}
        </nav>
      </div>
      <div className={PICKER_PANEL}>
        {roots.state.status === 'loading' || (list === undefined && roots.state.status === 'ready' && rootList.length > 0) || list?.status === 'loading' ? <LoadingLine what="Reading the folder..." /> : null}
        {roots.state.status === 'failed' ? <FailedLine text={roots.state.text} onRetry={roots.retry} /> : null}
        {roots.state.status === 'ready' && rootList.length === 0 ? <EmptyLine>Nothing to browse yet. Type the path in the Folder field, or add a folder with: agent-manager launch-roots add &lt;path&gt;</EmptyLine> : null}
        {list?.status === 'failed' && dir !== undefined ? <FailedLine text={list.text} onRetry={() => reload(dir)} /> : null}
        {here !== undefined && here.entries.length === 0 ? <EmptyLine>No subfolder in {here.name}.{here.skipped > 0 ? ` ${here.skipped} hidden or linked folder${here.skipped === 1 ? ' is' : 's are'} not listed.` : ''}</EmptyLine> : null}
        {here !== undefined && here.entries.length > 0 ? (
          <ul ref={box} aria-label={`Folders in ${here.path}`} onKeyDown={onKeyDown}>
            {here.entries.map((entry, index) => (
              <li key={entry.path} className="flex items-center pr-1">
                <button
                  type="button"
                  data-explorer-row=""
                  tabIndex={index === 0 ? 0 : -1}
                  disabled={disabled}
                  title={entry.path}
                  onClick={() => onPick(pickOf(entry))}
                  onDoubleClick={() => enter(entry)}
                  className={`${PICKER_ROW} min-w-0 flex-1 ${samePath(value, entry.path) ? PICKER_ROW_SELECTED : ''}`}
                >
                  <FolderGlyph entry={entry} />
                  <span className="min-w-0 truncate">{entry.name}</span>
                  <BranchBadge branch={entry.branch} />
                </button>
                {/* Not a tab stop: with a few hundred folders it would be as many; the keyboard opens a row with Enter or Right. */}
                <button type="button" tabIndex={-1} aria-label={`Open ${entry.name}`} title={`Open ${entry.name}`} disabled={disabled} onClick={() => enter(entry)} className={ICON_BUTTON_CLASS}>
                  <ChevronRight aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {here?.truncated === true ? <TruncatedLine limit={here.limit} /> : null}
      </div>
    </div>
  );
}
