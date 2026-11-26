import { Tooltip } from '@wadeck-app/dsl-ui';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useFolderLists, useFolderRecent, useFolderRoots, useFolderSearch } from '../data/useFolders.js';
import { completed, pickOf, samePath, splitTyped, startingWith, type FolderPick } from '../logic/folderPicker.js';
import { Highlight } from '../lists/Highlight.js';
import { Banner } from '../ui/Banner.js';
import { BranchBadge } from './BranchBadge.js';
import { EmptyLine } from './EmptyLine.js';
import { FailedLine } from './FailedLine.js';
import { FolderGlyph } from './FolderGlyph.js';
import { ListCaption } from './ListCaption.js';
import { LoadingLine } from './LoadingLine.js';
import { PICKER_PANEL, PICKER_ROW, PICKER_ROW_SELECTED } from './folderParts.js';

export interface PaletteProps {
  inputId: string;
  value: string;
  onChange: (text: string) => void;
  onPick: (pick: FolderPick) => void;
  /** What is known of the folder the text now names: a completion keeps its own text (with the separator) and only tells the dialog about the folder. */
  onKnow: (pick: FolderPick) => void;
  disabled: boolean;
  invalid: boolean;
  placeholder: string;
  className: string;
}

interface Option {
  id: string;
  kind: 'sub' | 'recent' | 'project' | 'root';
  path: string;
  name: string;
  hasGit: boolean;
  branch?: string;
}

const CAPTION: Record<Option['kind'], string> = { sub: 'Folders here', recent: 'Recent folders', project: 'Known projects', root: 'Start from' };
/** Recent folders offered next to the completions of a path. */
const RECENT_SHOWN = 6;

/**
 * V5, the palette: the Folder field itself completes the path while you type, like a shell. The folders under the last complete segment that start with what
 * you typed are listed (with the recent folders that match); Up and Down choose, Tab completes the highlighted one (the first when none is) and adds the
 * separator for the next segment, Enter picks the highlighted one. Without any highlighted folder, Enter launches as in every variant. A word without a
 * separator searches the known projects. A path outside the browsable folders is still accepted as typed: it is checked when the session is launched.
 */
export function FolderPalette({ inputId, value, onChange, onPick, onKnow, disabled, invalid, placeholder, className }: PaletteProps) {
  const roots = useFolderRoots();
  const recent = useFolderRecent();
  const { lists, ensure, reload } = useFolderLists();
  const [active, setActive] = useState(-1);
  const typed = splitTyped(value);
  const word = typed === undefined && value.trim() !== '' ? value.trim() : undefined;
  const search = useFolderSearch(word);

  // The folder being completed is read once (the list is kept: the next letters filter it without a request).
  useEffect(() => {
    if (typed !== undefined) {
      ensure(typed.dir);
    }
  }, [typed?.dir, ensure]);

  const list = typed === undefined ? undefined : lists[typed.dir];
  const lower = value.trim().toLowerCase();

  const { options, notice } = useMemo(() => {
    const out: Option[] = [];
    let notice: { tone: 'info' | 'error' | 'loading'; text: string; code?: string } | undefined;
    if (typed !== undefined) {
      if (list === undefined || list.status === 'loading') {
        notice = { tone: 'loading', text: 'Reading the folder...' };
      } else if (list.status === 'failed') {
        notice = { tone: list.code === 'folder-not-browsable' ? 'info' : 'error', text: list.text, ...(list.code === undefined ? {} : { code: list.code }) };
      } else {
        startingWith(list.value.entries, typed.partial).forEach((entry) => out.push({ id: `sub-${entry.path}`, kind: 'sub', path: entry.path, name: entry.name, hasGit: entry.hasGit, ...(entry.branch === undefined ? {} : { branch: entry.branch }) }));
      }
      if (recent.state.status === 'ready' && lower !== '') {
        recent.state.value.folders
          .filter((folder) => folder.exists && folder.path.toLowerCase().includes(lower) && !out.some((option) => samePath(option.path, folder.path)))
          .slice(0, RECENT_SHOWN)
          .forEach((folder) => out.push({ id: `recent-${folder.path}`, kind: 'recent', path: folder.path, name: folder.name, hasGit: folder.hasGit, ...(folder.branch === undefined ? {} : { branch: folder.branch }) }));
      }
    } else if (word !== undefined) {
      if (search === undefined || search.status === 'loading') {
        notice = { tone: 'loading', text: 'Searching...' };
      } else if (search.status === 'failed') {
        notice = { tone: 'error', text: search.text };
      } else {
        search.value.results.forEach((result) => out.push({ id: `project-${result.path}`, kind: 'project', path: result.path, name: result.name, hasGit: result.hasGit, ...(result.branch === undefined ? {} : { branch: result.branch }) }));
      }
    } else {
      if (recent.state.status === 'ready') {
        recent.state.value.folders
          .filter((folder) => folder.exists)
          .slice(0, RECENT_SHOWN)
          .forEach((folder) => out.push({ id: `recent-${folder.path}`, kind: 'recent', path: folder.path, name: folder.name, hasGit: folder.hasGit, ...(folder.branch === undefined ? {} : { branch: folder.branch }) }));
      }
      if (roots.state.status === 'ready') {
        roots.state.value.roots.forEach((root) => out.push({ id: `root-${root.path}`, kind: 'root', path: root.path, name: root.path, hasGit: false }));
      }
    }
    return { options: out, notice };
  }, [typed?.dir, typed?.partial, list, recent.state, roots.state, search, word, lower]);

  // The highlighted option never points past the end of a list that got shorter.
  const current = active >= 0 && active < options.length ? active : -1;

  const choose = (option: Option): void => {
    onChange(option.path);
    onPick(pickOf({ path: option.path, name: option.name, hasGit: option.hasGit, branch: option.branch }));
    setActive(-1);
  };

  const complete = (option: Option): void => {
    // The separator of the text typed so far (a path typed with slashes keeps its slashes); a first completion from a word uses the one the path has.
    const separator = option.path.includes('\\') ? '\\' : '/';
    onChange(`${option.path}${separator}`);
    onKnow(pickOf({ path: option.path, name: option.name, hasGit: option.hasGit, branch: option.branch }));
    setActive(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' && options.length > 0) {
      setActive((previous) => (previous + 1 >= options.length ? 0 : previous + 1));
    } else if (event.key === 'ArrowUp' && options.length > 0) {
      setActive((previous) => (previous <= 0 ? options.length - 1 : previous - 1));
    } else if (event.key === 'Tab' && !event.shiftKey && options.length > 0) {
      const option = options[current >= 0 ? current : 0]!;
      if (typed !== undefined && option.kind === 'sub') {
        onChange(completed(typed, option));
        onKnow(pickOf({ path: option.path, name: option.name, hasGit: option.hasGit, branch: option.branch }));
        setActive(-1);
      } else {
        complete(option);
      }
    } else if (event.key === 'Enter' && current >= 0) {
      choose(options[current]!);
    } else {
      return;
    }
    event.preventDefault();
  };

  const terms = typed === undefined ? (word === undefined ? undefined : [word]) : typed.partial === '' ? undefined : [typed.partial];
  const kinds = (['sub', 'recent', 'project', 'root'] as const).filter((kind) => options.some((option) => option.kind === kind));
  const activeId = current >= 0 ? `${inputId}-option-${current}` : undefined;
  const listboxId = `${inputId}-options`;

  return (
    <div className="flex flex-col gap-1.5" data-folder-picker="palette">
      <input
        id={inputId}
        data-autofocus=""
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={invalid}
        placeholder={placeholder}
        className={className}
      />
      <div className={PICKER_PANEL}>
        <p className="px-2 py-1 text-xs text-muted">Type a path. Up and Down choose, Tab completes the next folder, Enter picks the highlighted one.</p>
        {notice?.tone === 'loading' ? <LoadingLine what={notice.text} /> : null}
        {notice?.tone === 'info' ? (
          <div className="p-1">
            <Banner tone="info">{notice.text} The path is used as typed.</Banner>
          </div>
        ) : null}
        {notice?.tone === 'error' ? <FailedLine text={notice.text} onRetry={typed === undefined ? undefined : () => reload(typed.dir)} /> : null}
        {notice === undefined && options.length === 0 ? <EmptyLine>{typed === undefined && word === undefined ? 'No recent folder or root yet. Type the absolute path of the folder.' : typed !== undefined && typed.partial === '' ? 'No subfolder here. The path is used as typed.' : 'Nothing matches. The path is used as typed.'}</EmptyLine> : null}
        <div id={listboxId} role="listbox" aria-label="Folder suggestions">
          {kinds.map((kind) => (
            <div key={kind} role="group" aria-label={CAPTION[kind]}>
              <ListCaption>{CAPTION[kind]}</ListCaption>
              {options.map((option, index) =>
                option.kind !== kind ? null : (
                  <Tooltip key={option.id} content={option.path}>
                    <div
                      data-tip-fill=""
                      id={`${inputId}-option-${index}`}
                      role="option"
                      aria-selected={index === current}
                      // The input keeps the focus: a click picks without taking it away.
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => (disabled ? undefined : choose(option))}
                      className={`${PICKER_ROW} cursor-pointer ${index === current ? PICKER_ROW_SELECTED : ''}`}
                    >
                      <FolderGlyph entry={{ hasGit: option.hasGit, isLink: false }} />
                      <span className="shrink-0 font-medium">
                        <Highlight text={option.kind === 'root' ? option.path : option.name} terms={option.kind === 'root' ? undefined : terms} />
                      </span>
                      <BranchBadge branch={option.branch} />
                      {option.kind === 'recent' || option.kind === 'project' ? <span className="min-w-0 truncate text-xs text-muted">{option.path}</span> : null}
                    </div>
                  </Tooltip>
                ),
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
