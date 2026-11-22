import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useFolderLists, useFolderRoots } from '../data/useFolders.js';
import { fuzzyScore } from '../logic/fuzzy.js';
import { pickOf, samePath, type FolderPick } from '../logic/folderPicker.js';
import type { FolderEntryDto } from '../shared.js';
import { FOCUS_RING } from '../ui/focusRing.js';
import { BranchBadge } from './BranchBadge.js';
import { EmptyLine } from './EmptyLine.js';
import { FailedLine } from './FailedLine.js';
import { FolderGlyph } from './FolderGlyph.js';
import { LoadingLine } from './LoadingLine.js';
import { RootsNote } from './RootsNote.js';
import { TruncatedLine } from './TruncatedLine.js';
import { PICKER_PANEL, PICKER_ROW, PICKER_ROW_SELECTED } from './folderParts.js';

export interface TreeProps {
  /** The text of the Folder field: the row of that folder is highlighted. */
  value: string;
  onPick: (pick: FolderPick) => void;
  disabled: boolean;
}

type Row =
  | { kind: 'folder'; path: string; entry: FolderEntryDto; depth: number; expanded: boolean }
  | { kind: 'loading' | 'empty' | 'truncated'; key: string; depth: number; limit?: number; filtered?: boolean }
  | { kind: 'failed'; key: string; depth: number; path: string; text: string };

/** The names that match the filter (a fuzzy match, the order of the folder kept). */
function matching(entries: readonly FolderEntryDto[], filter: string): FolderEntryDto[] {
  return filter.trim() === '' ? [...entries] : entries.filter((entry) => fuzzyScore(filter.trim(), entry.name) !== undefined);
}

/**
 * V1, the tree: the roots at the top, a folder opens in place (the folders below it are read when it opens) like the explorer of a code editor.
 * A click picks the folder and opens or closes it; Right opens, Left closes (or goes to the parent), Up and Down walk the visible folders, Home and End jump.
 * The filter keeps the folders whose name matches, at every level that is open.
 */
export function FolderTree({ value, onPick, disabled }: TreeProps) {
  const roots = useFolderRoots();
  const { lists, ensure, reload } = useFolderLists();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState<string | undefined>(undefined);
  const focusAfter = useRef(false);
  const box = useRef<HTMLUListElement>(null);
  const filterId = useId();

  const rootEntries: FolderEntryDto[] = useMemo(
    () => (roots.state.status === 'ready' ? roots.state.value.roots.map((root) => ({ name: root.name, path: root.path, hasGit: false, isRecent: false, isKnownProject: false, isLink: false })) : []),
    [roots.state],
  );

  // A single root is opened for the user: the first thing they would do.
  const [autoOpened, setAutoOpened] = useState(false);
  useEffect(() => {
    const only = rootEntries.length === 1 ? rootEntries[0] : undefined;
    if (!autoOpened && only !== undefined) {
      setAutoOpened(true);
      setExpanded(new Set([only.path]));
      ensure(only.path);
    }
  }, [rootEntries, autoOpened, ensure]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (entries: readonly FolderEntryDto[], depth: number): void => {
      // The roots are never filtered away: the filter narrows what is inside them.
      for (const entry of depth === 0 ? entries : matching(entries, filter)) {
        const open = expanded.has(entry.path);
        out.push({ kind: 'folder', path: entry.path, entry, depth, expanded: open });
        if (!open) {
          continue;
        }
        const list = lists[entry.path];
        if (list === undefined || list.status === 'loading') {
          out.push({ kind: 'loading', key: `${entry.path}#loading`, depth: depth + 1 });
        } else if (list.status === 'failed') {
          out.push({ kind: 'failed', key: `${entry.path}#failed`, depth: depth + 1, path: entry.path, text: list.text });
        } else {
          const shown = matching(list.value.entries, filter);
          if (shown.length === 0) {
            out.push({ kind: 'empty', key: `${entry.path}#empty`, depth: depth + 1, filtered: list.value.entries.length > 0 });
          }
          walk(list.value.entries, depth + 1);
          if (list.value.truncated) {
            out.push({ kind: 'truncated', key: `${entry.path}#truncated`, depth: depth + 1, limit: list.value.limit });
          }
        }
      }
    };
    walk(rootEntries, 0);
    return out;
  }, [rootEntries, expanded, lists, filter]);

  const folders = rows.filter((row): row is Extract<Row, { kind: 'folder' }> => row.kind === 'folder');
  const current = active !== undefined && folders.some((row) => row.path === active) ? active : folders[0]?.path;

  useEffect(() => {
    if (!focusAfter.current || active === undefined) {
      return;
    }
    focusAfter.current = false;
    Array.from(box.current?.querySelectorAll<HTMLElement>('[data-folder-path]') ?? [])
      .find((element) => element.dataset['folderPath'] === active)
      ?.focus();
  }, [active]);

  const toggle = (path: string, open: boolean): void => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (open) {
        next.add(path);
      } else {
        next.delete(path);
      }
      return next;
    });
    if (open) {
      ensure(path);
    }
  };

  const choose = (row: Extract<Row, { kind: 'folder' }>): void => {
    setActive(row.path);
    onPick(pickOf(row.entry));
    toggle(row.path, !row.expanded);
  };

  const move = (target: string | undefined): void => {
    if (target !== undefined) {
      focusAfter.current = true;
      setActive(target);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    const index = folders.findIndex((row) => row.path === current);
    const row = folders[index];
    if (row === undefined) {
      return;
    }
    const actions: Record<string, () => void> = {
      ArrowDown: () => move(folders[Math.min(index + 1, folders.length - 1)]?.path),
      ArrowUp: () => move(folders[Math.max(index - 1, 0)]?.path),
      Home: () => move(folders[0]?.path),
      End: () => move(folders[folders.length - 1]?.path),
      ArrowRight: () => {
        if (!row.expanded) {
          toggle(row.path, true);
        } else {
          move(folders[index + 1]?.depth === row.depth + 1 ? folders[index + 1]?.path : undefined);
        }
      },
      ArrowLeft: () => {
        if (row.expanded) {
          toggle(row.path, false);
        } else {
          // The parent is the closest row above that is one level up.
          move([...folders.slice(0, index)].reverse().find((candidate) => candidate.depth === row.depth - 1)?.path);
        }
      },
      Enter: () => choose(row),
      ' ': () => choose(row),
    };
    const action = actions[event.key];
    if (action === undefined) {
      return;
    }
    action();
    event.preventDefault();
  };

  return (
    <div className="flex flex-col gap-1.5" data-folder-picker="tree">
      <RootsNote note={roots.state.status === 'ready' ? roots.state.value.note : ''} />
      <div className="relative">
        <label htmlFor={filterId} className="sr-only">
          Filter the folders
        </label>
        <Search aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 h-am-icon-sm w-am-icon-sm -translate-y-1/2 text-muted" />
        <input
          id={filterId}
          type="text"
          value={filter}
          disabled={disabled}
          onChange={(event) => setFilter(event.target.value)}
          onKeyDown={(event) => {
            // Enter in a filter must not submit the dialog (it would launch).
            if (event.key === 'Enter') {
              event.preventDefault();
            }
          }}
          placeholder="Filter the open folders"
          autoComplete="off"
          spellCheck={false}
          className={`w-full rounded border border-border bg-surface py-1 pl-7 pr-2 text-sm text-content placeholder:text-muted ${FOCUS_RING}`}
        />
      </div>
      <div className={PICKER_PANEL}>
        {roots.state.status === 'loading' ? <LoadingLine what="Reading the folders you can browse..." /> : null}
        {roots.state.status === 'failed' ? <FailedLine text={roots.state.text} onRetry={roots.retry} /> : null}
        {roots.state.status === 'ready' && rootEntries.length === 0 ? <EmptyLine>Nothing to browse yet. Type the path in the Folder field, or add a folder with: agent-manager launch-roots add &lt;path&gt;</EmptyLine> : null}
        {rows.length > 0 ? (
          <ul ref={box} role="tree" aria-label="Folders" onKeyDown={onKeyDown}>
            {rows.map((row) => {
              const indent = { paddingLeft: `calc(${row.depth} * 1rem + 0.5rem)` };
              if (row.kind === 'folder') {
                const selected = samePath(value, row.path);
                const Chevron = row.expanded ? ChevronDown : ChevronRight;
                return (
                  <li key={row.path} role="none">
                    <div
                      role="treeitem"
                      aria-level={row.depth + 1}
                      aria-expanded={row.expanded}
                      aria-selected={selected}
                      tabIndex={row.path === current ? 0 : -1}
                      data-folder-path={row.path}
                      title={row.path}
                      onClick={() => (disabled ? undefined : choose(row))}
                      onFocus={() => setActive(row.path)}
                      style={indent}
                      className={`${PICKER_ROW} cursor-pointer ${selected ? PICKER_ROW_SELECTED : ''}`}
                    >
                      <Chevron aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0 text-muted" />
                      <FolderGlyph entry={row.entry} />
                      <span className="min-w-0 truncate">{row.entry.name}</span>
                      <BranchBadge branch={row.entry.branch} />
                    </div>
                  </li>
                );
              }
              if (row.kind === 'failed') {
                return (
                  <li key={row.key} role="none" style={indent}>
                    <FailedLine text={row.text} onRetry={() => reload(row.path)} />
                  </li>
                );
              }
              return (
                <li key={row.key} role="none" style={indent}>
                  {row.kind === 'loading' ? <LoadingLine what="Reading the folder..." /> : null}
                  {row.kind === 'empty' ? <EmptyLine>{row.filtered === true ? 'No folder matches the filter.' : 'No subfolder.'}</EmptyLine> : null}
                  {row.kind === 'truncated' ? <TruncatedLine limit={row.limit ?? 0} /> : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
