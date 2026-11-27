import { Tooltip } from '@wadeck-app/dsl-ui';
import { ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useFolderLists, useFolderRoots, type Loadable } from '../data/useFolders.js';
import { pickOf, samePath, type FolderPick } from '../logic/folderPicker.js';
import type { FolderEntryDto, FolderListOk } from '../shared.js';
import { BranchBadge } from './BranchBadge.js';
import { EmptyLine } from './EmptyLine.js';
import { FailedLine } from './FailedLine.js';
import { FolderGlyph } from './FolderGlyph.js';
import { LoadingLine } from './LoadingLine.js';
import { RootsNote } from './RootsNote.js';
import { TruncatedLine } from './TruncatedLine.js';
import { PICKER_ROW, PICKER_ROW_SELECTED } from './folderParts.js';

const COLUMNS_SCROLLER = 'flex h-72 overflow-x-auto overflow-y-hidden rounded border border-border bg-surface';
const COLUMN = 'flex w-60 shrink-0 flex-col overflow-y-auto border-r border-border last:border-r-0';

export interface ColumnsProps {
  value: string;
  onPick: (pick: FolderPick) => void;
  disabled: boolean;
}

interface Column {
  /** The folder whose subfolders the column lists; undefined for the first column (the roots). */
  parent: string | undefined;
  /** The folder selected in this column: it opens the next one. */
  selected: string | undefined;
}

/**
 * V2, Miller columns (the Finder, ranger and yazi): the roots in the first column, the subfolders of the selected folder in the next, left to right. A click or
 * Enter selects a folder and opens its column (and fills the Folder field); Up and Down walk a column, Right goes into the next column (opening the folder first when
 * it is not open), Left goes back to the selected folder of the previous column. Walking does not read anything: only a selection does.
 */
export function FolderColumns({ value, onPick, disabled }: ColumnsProps) {
  const roots = useFolderRoots();
  const { lists, ensure, reload } = useFolderLists();
  const [trail, setTrail] = useState<readonly string[]>([]);
  // Where the focus goes once that column has options: a request made before the folder was read.
  const [want, setWant] = useState<{ column: number } | undefined>(undefined);
  const scroller = useRef<HTMLDivElement>(null);

  const rootEntries: FolderEntryDto[] = useMemo(
    () => (roots.state.status === 'ready' ? roots.state.value.roots.map((root) => ({ name: root.name, path: root.path, hasGit: false, isRecent: false, isKnownProject: false, isLink: false })) : []),
    [roots.state],
  );

  const [autoOpened, setAutoOpened] = useState(false);
  useEffect(() => {
    const only = rootEntries.length === 1 ? rootEntries[0] : undefined;
    if (!autoOpened && only !== undefined) {
      setAutoOpened(true);
      setTrail([only.path]);
      ensure(only.path);
    }
  }, [rootEntries, autoOpened, ensure]);

  const columns: Column[] = [{ parent: undefined, selected: trail[0] }, ...trail.map((path, index) => ({ parent: path, selected: trail[index + 1] }))];

  const entriesOf = (column: Column): Loadable<{ entries: readonly FolderEntryDto[]; list?: FolderListOk }> => {
    if (column.parent === undefined) {
      return roots.state.status === 'ready' ? { status: 'ready', value: { entries: rootEntries } } : roots.state;
    }
    const list = lists[column.parent];
    if (list === undefined) {
      return { status: 'loading' };
    }
    return list.status === 'ready' ? { status: 'ready', value: { entries: list.value.entries, list: list.value } } : list;
  };

  const columnElement = (index: number): HTMLElement | null => scroller.current?.querySelector<HTMLElement>(`[data-column="${index}"]`) ?? null;
  const entryPoint = (index: number): HTMLElement | null => columnElement(index)?.querySelector<HTMLElement>('[role="option"][tabindex="0"]') ?? null;

  // The next column scrolls into view when it opens, and takes the focus when the user asked for it with the keyboard.
  useEffect(() => {
    const box = scroller.current;
    if (box !== null) {
      box.scrollLeft = box.scrollWidth;
    }
  }, [trail.length]);
  useEffect(() => {
    if (want === undefined) {
      return;
    }
    const target = entryPoint(want.column);
    if (target !== null) {
      setWant(undefined);
      target.focus();
    }
  });

  const select = (columnIndex: number, entry: FolderEntryDto, focusNext: boolean): void => {
    setTrail([...trail.slice(0, columnIndex), entry.path]);
    ensure(entry.path);
    onPick(pickOf(entry));
    setWant(focusNext ? { column: columnIndex + 1 } : undefined);
  };

  const onKeyDown = (columnIndex: number, entries: readonly FolderEntryDto[]) => (event: KeyboardEvent<HTMLDivElement>) => {
    const options = Array.from(columnElement(columnIndex)?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    const at = options.findIndex((option) => option === document.activeElement);
    const entry = entries[at];
    if (at < 0 || entry === undefined) {
      return;
    }
    const actions: Record<string, () => void> = {
      ArrowDown: () => options[Math.min(at + 1, options.length - 1)]?.focus(),
      ArrowUp: () => options[Math.max(at - 1, 0)]?.focus(),
      Home: () => options[0]?.focus(),
      End: () => options[options.length - 1]?.focus(),
      ArrowRight: () => {
        if (trail[columnIndex] === entry.path) {
          setWant({ column: columnIndex + 1 });
        } else {
          select(columnIndex, entry, true);
        }
      },
      ArrowLeft: () => {
        if (columnIndex > 0) {
          entryPoint(columnIndex - 1)?.focus();
        }
      },
      Enter: () => select(columnIndex, entry, false),
      ' ': () => select(columnIndex, entry, false),
    };
    const action = actions[event.key];
    if (action === undefined) {
      return;
    }
    action();
    event.preventDefault();
  };

  return (
    <div className="flex flex-col gap-1.5" data-folder-picker="columns">
      <RootsNote note={roots.state.status === 'ready' ? roots.state.value.note : ''} />
      <div ref={scroller} className={COLUMNS_SCROLLER}>
        {columns.map((column, index) => {
          const state = entriesOf(column);
          const entries = state.status === 'ready' ? state.value.entries : [];
          const entryPointPath = column.selected ?? entries[0]?.path;
          const label = column.parent === undefined ? 'Roots' : `Folders in ${column.parent}`;
          return (
            <div key={column.parent ?? 'roots'} data-column={index} className={COLUMN}>
              {state.status === 'loading' ? <LoadingLine what={column.parent === undefined ? 'Reading the folders you can browse...' : 'Reading the folder...'} /> : null}
              {state.status === 'failed' ? <FailedLine text={state.text} onRetry={column.parent === undefined ? roots.retry : () => reload(column.parent!)} /> : null}
              {state.status === 'ready' && entries.length === 0 ? (
                <EmptyLine>{column.parent === undefined ? 'Nothing to browse yet. Type the path in the Folder field, or add a folder with: agent-manager launch-roots add <path>' : 'No subfolder.'}</EmptyLine>
              ) : null}
              {entries.length > 0 ? (
                <div role="listbox" aria-label={label} onKeyDown={onKeyDown(index, entries)}>
                  {entries.map((entry) => {
                    const open = column.selected === entry.path;
                    const picked = samePath(value, entry.path);
                    return (
                      <Tooltip key={entry.path} content={entry.path}>
                        <div
                          data-tip-fill=""
                          role="option"
                          aria-selected={open}
                          tabIndex={entry.path === entryPointPath ? 0 : -1}
                          onClick={() => (disabled ? undefined : select(index, entry, false))}
                          className={`${PICKER_ROW} cursor-pointer ${open || picked ? PICKER_ROW_SELECTED : ''}`}
                        >
                          <FolderGlyph entry={entry} />
                          <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                          <BranchBadge branch={entry.branch} />
                          <ChevronRight aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0 text-muted" />
                        </div>
                      </Tooltip>
                    );
                  })}
                </div>
              ) : null}
              {state.status === 'ready' && state.value.list?.truncated === true ? <TruncatedLine limit={state.value.list.limit} /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
