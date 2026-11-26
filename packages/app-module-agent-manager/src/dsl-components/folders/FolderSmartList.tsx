import { Pin, PinOff, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useFolderRecent, useFolderSearch } from '../data/useFolders.js';
import { folderName, pickOf, readFavorites, saveFavorites, samePath, toggleFavorite, type FolderPick } from '../logic/folderPicker.js';
import { Banner } from '../ui/Banner.js';
import { IconButton, Tooltip } from '@wadeck-app/dsl-ui';
import { FOCUS_RING } from '../ui/focusRing.js';
import { Highlight } from '../lists/Highlight.js';
import { BranchBadge } from './BranchBadge.js';
import { EmptyLine } from './EmptyLine.js';
import { FailedLine } from './FailedLine.js';
import { FolderGlyph } from './FolderGlyph.js';
import { ListCaption } from './ListCaption.js';
import { LoadingLine } from './LoadingLine.js';
import { PICKER_PANEL, PICKER_ROW, PICKER_ROW_SELECTED } from './folderParts.js';

export interface SmartListProps {
  value: string;
  onPick: (pick: FolderPick) => void;
  disabled: boolean;
}

interface Item {
  path: string;
  name: string;
  branch?: string;
  hasGit: boolean;
  /** Recent folders whose folder is gone are listed but cannot be picked. */
  missing: boolean;
}

/** The folder a path sits in, for the muted text beside the name. */
function parentText(path: string): string {
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return cut <= 0 ? '' : path.slice(0, cut);
}

/**
 * V3, the smart list: the folders you pinned, then the ones you used recently; typing searches the known projects (recent folders and the folders at depth 1 and 2
 * of the browsable roots) with a fuzzy match. No browsing: the common case is to start again where you already work. The star pins a folder: pins are kept in this
 * browser (localStorage `agent-manager.launch-favorites.v1`), not on the server. Down from the search box enters the list, Up and Down walk it, Enter picks.
 */
export function FolderSmartList({ value, onPick, disabled }: SmartListProps) {
  const [query, setQuery] = useState('');
  const [favorites, setFavorites] = useState(readFavorites);
  const [note, setNote] = useState(favorites.problem);
  const recent = useFolderRecent();
  const search = useFolderSearch(query.trim() === '' ? undefined : query.trim());
  const box = useRef<HTMLDivElement>(null);
  const searchId = useId();
  const pinned = favorites.folders;
  const [enterWaits, setEnterWaits] = useState(false);
  // The answer on screen is the one for what is in the box (an older answer stays on screen for a moment while the next is asked).
  const fresh = search?.status === 'ready' && search.value.query === query.trim();
  useEffect(() => {
    if (enterWaits && (fresh || search?.status === 'failed')) {
      setEnterWaits(false);
      if (fresh) {
        rows()[0]?.click();
      }
    }
  });

  // What is known about a folder, from whichever answer mentions it first: a pin has only a path.
  const known = useMemo(() => {
    const map = new Map<string, Item>();
    const add = (item: Item): void => {
      const key = item.path.toLowerCase();
      if (!map.has(key)) {
        map.set(key, item);
      }
    };
    if (recent.state.status === 'ready') {
      recent.state.value.folders.forEach((folder) => add({ path: folder.path, name: folder.name, hasGit: folder.hasGit, missing: !folder.exists, ...(folder.branch === undefined ? {} : { branch: folder.branch }) }));
    }
    if (search?.status === 'ready') {
      search.value.results.forEach((result) => add({ path: result.path, name: result.name, hasGit: result.hasGit, missing: false, ...(result.branch === undefined ? {} : { branch: result.branch }) }));
    }
    return map;
  }, [recent.state, search]);

  const itemOf = (path: string): Item => known.get(path.toLowerCase()) ?? { path, name: folderName(path), hasGit: false, missing: false };

  const pin = (path: string): void => {
    const next = toggleFavorite(pinned, path);
    if (next.problem !== '') {
      setNote(next.problem);
      return;
    }
    setFavorites({ folders: next.folders, problem: '' });
    setNote(saveFavorites(next.folders));
  };

  const rows = (): HTMLElement[] => Array.from(box.current?.querySelectorAll<HTMLElement>('[data-smart-row]') ?? []);

  const onRowKeys = (event: KeyboardEvent<HTMLDivElement>): void => {
    const list = rows();
    const at = list.findIndex((row) => row === document.activeElement);
    if (at < 0) {
      return;
    }
    if (event.key === 'ArrowDown') {
      list[Math.min(at + 1, list.length - 1)]?.focus();
    } else if (event.key === 'ArrowUp') {
      if (at === 0) {
        document.getElementById(searchId)?.focus();
      } else {
        list[at - 1]?.focus();
      }
    } else {
      return;
    }
    event.preventDefault();
  };

  const onSearchKeys = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      rows()[0]?.focus();
      event.preventDefault();
    } else if (event.key === 'Enter') {
      // Enter in the search box picks the first folder (it must never submit the dialog: that would launch). While the answer for what was typed is still on its way,
      // the Enter waits for it (the list says "Searching...").
      event.preventDefault();
      if (search === undefined || fresh) {
        rows()[0]?.click();
      } else {
        setEnterWaits(true);
      }
    }
  };

  const renderItem = (item: Item, terms: readonly string[] | undefined) => {
    const selected = samePath(value, item.path);
    const isPinned = pinned.some((path) => samePath(path, item.path));
    const dir = parentText(item.path);
    return (
      <li key={item.path} className="flex items-center gap-0.5 pr-1">
        <Tooltip content={item.missing ? `${item.path} no longer exists` : item.path}>
          <button
            data-tip-fill=""
            type="button"
            data-smart-row=""
            disabled={disabled || item.missing}
            onClick={() => onPick(pickOf({ path: item.path, name: item.name, hasGit: item.hasGit, branch: item.branch }))}
            className={`${PICKER_ROW} min-w-0 flex-1 disabled:cursor-not-allowed disabled:opacity-60 ${selected ? PICKER_ROW_SELECTED : ''}`}
          >
            <FolderGlyph entry={{ hasGit: item.hasGit, isLink: false }} />
            <span className="shrink-0 font-medium">
              <Highlight text={item.name} terms={terms} />
            </span>
            <BranchBadge branch={item.branch} />
            <span className="min-w-0 truncate text-xs text-muted">{item.missing ? 'no longer exists' : dir}</span>
          </button>
        </Tooltip>
        <IconButton size="icon-sm" variant={isPinned ? 'neutral' : 'ghost'} icon={isPinned ? <PinOff aria-hidden="true" className="h-4 w-4" /> : <Pin aria-hidden="true" className="h-4 w-4" />} aria-label={isPinned ? `Unpin ${item.name}` : `Pin ${item.name}`} aria-pressed={isPinned} disabled={disabled} onClick={() => pin(item.path)} />
      </li>
    );
  };

  const searching = search !== undefined;
  const pinnedItems = pinned.map(itemOf);
  const recentItems = recent.state.status === 'ready' ? recent.state.value.folders.filter((folder) => !pinned.some((path) => samePath(path, folder.path))).map((folder) => itemOf(folder.path)) : [];
  const terms = searching ? query.trim().split(/\s+/) : undefined;
  const warnings = [...(recent.state.status === 'ready' ? recent.state.value.warnings : []), ...(search?.status === 'ready' ? search.value.warnings : [])];

  return (
    <div className="flex flex-col gap-1.5" data-folder-picker="smart">
      <div className="relative">
        <label htmlFor={searchId} className="sr-only">
          Search the known projects
        </label>
        <Search aria-hidden="true" className="pointer-events-none absolute left-2 top-1/2 h-am-icon-sm w-am-icon-sm -translate-y-1/2 text-muted" />
        <input
          id={searchId}
          type="text"
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onSearchKeys}
          placeholder="Search your projects"
          autoComplete="off"
          spellCheck={false}
          className={`w-full rounded border border-border bg-surface py-1 pl-7 pr-2 text-sm text-content placeholder:text-muted ${FOCUS_RING}`}
        />
      </div>
      {note !== '' ? <Banner tone="warning">{note}</Banner> : null}
      {warnings.map((warning) => (
        <Banner key={warning} tone="warning">
          {warning}
        </Banner>
      ))}
      <div ref={box} onKeyDown={onRowKeys} className={PICKER_PANEL}>
        {searching ? (
          <>
            {search.status === 'loading' ? <LoadingLine what="Searching..." /> : null}
            {search.status === 'failed' ? <FailedLine text={search.text} /> : null}
            {search.status === 'ready' && search.value.results.length === 0 ? (
              <EmptyLine>No known project matches &quot;{query.trim()}&quot;. Type the full path in the Folder field, or add the folder that holds your projects with: agent-manager launch-roots add &lt;path&gt;</EmptyLine>
            ) : null}
            {search.status === 'ready' && search.value.results.length > 0 ? (
              <ul aria-label="Search results">{search.value.results.map((result) => renderItem(itemOf(result.path), terms))}</ul>
            ) : null}
            {search.status === 'ready' && search.value.truncated ? (
              <p role="status" data-truncated="" className="px-2 py-1.5 text-xs text-muted">
                More folders match: type more of the name to narrow the list.
              </p>
            ) : null}
          </>
        ) : (
          <>
            {pinnedItems.length > 0 ? (
              <>
                <ListCaption>Pinned</ListCaption>
                <ul aria-label="Pinned folders">{pinnedItems.map((item) => renderItem(item, undefined))}</ul>
              </>
            ) : null}
            {recent.state.status === 'loading' ? <LoadingLine what="Reading your recent folders..." /> : null}
            {recent.state.status === 'failed' ? <FailedLine text={recent.state.text} onRetry={recent.retry} /> : null}
            {recentItems.length > 0 ? (
              <>
                <ListCaption>Recent</ListCaption>
                <ul aria-label="Recent folders">{recentItems.map((item) => renderItem(item, undefined))}</ul>
              </>
            ) : null}
            {recent.state.status === 'ready' && pinnedItems.length === 0 && recentItems.length === 0 ? (
              <EmptyLine>No recent folder yet. Type to search your projects, or type the path in the Folder field. The star pins a folder here.</EmptyLine>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
