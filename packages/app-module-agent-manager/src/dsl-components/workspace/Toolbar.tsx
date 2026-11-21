import { Plus } from 'lucide-react';
import { useMediaQuery } from '../ui/hooks.js';
import type { ModeId } from '../shared.js';
import type { ViewOptions } from '../logic/viewOptions.js';
import { DensityControl } from '../ui/DensityControl.js';
import { FOCUS_RING } from '../ui/IconButton.js';
import { ShortcutsHelp } from '../ui/ShortcutsHelp.js';
import { ModeToggle } from './ModeToggle.js';
import { NewGroupControl } from './NewGroupControl.js';
import { SearchBox, type SearchBoxProps } from './SearchBox.js';
import { ViewOptionsControl } from './ViewOptionsControl.js';

export interface ToolbarProps {
  /** Sessions in the list (before the search). */
  count: number;
  /** Dead sessions the filter hides (from the page answer); 0 when none or when they are shown. */
  hiddenDead: number;
  show: 'alive' | 'all';
  onShow: (show: 'alive' | 'all') => void;
  mode: ModeId;
  onMode: (mode: ModeId) => void;
  options: ViewOptions;
  onOptions: (next: ViewOptions) => void;
  search: SearchBoxProps;
  helpOpen: boolean;
  onHelpOpenChange: (open: boolean) => void;
  /** Opens the New session dialog. */
  onNewSession: () => void;
  /** Creates a custom group with this name; resolves true when it was created. Only the Tree lists the groups, so the button shows there only. */
  onNewGroup?: (name: string) => Promise<boolean>;
  /** A session is open: below the lg breakpoint the detail replaces the list, so the toolbar (which acts on the list) gives its room back to the detail. */
  detailOpen?: boolean;
}

/**
 * The one slim line at the top of the workspace (inside its box, not above it): what the page is, the toggle between the listing modes, the search, which
 * sessions to show, then the icon buttons (view options of the mode, text size, shortcut help).
 */
export function Toolbar({ count, hiddenDead, show, onShow, mode, onMode, options, onOptions, search, helpOpen, onHelpOpenChange, onNewSession, onNewGroup, detailOpen = false }: ToolbarProps) {
  // Under 1280 px (the shell menu takes 240 px of it) the toolbar keeps one row: icons for the modes and for New group, a number for the count, short labels.
  const countText = `${count} ${count === 1 ? 'session' : 'sessions'}${show === 'alive' && hiddenDead > 0 ? `, ${hiddenDead} ended hidden` : ''}`;
  const tight = useMediaQuery('(max-width: 1279px)');
  return (
    <div data-toolbar="" className={`${detailOpen ? 'hidden lg:flex' : 'flex'} min-h-am-hit flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1`}>
      <h1 className="text-base font-semibold leading-none text-content">Agents</h1>
      <span className="text-sm text-muted" title={tight ? countText : undefined}>
        {tight ? (
          <>
            <span aria-hidden="true">{count}</span>
            <span className="sr-only">{countText}</span>
          </>
        ) : (
          countText
        )}
      </span>
      <ModeToggle mode={mode} onMode={onMode} iconOnly={tight} />
      <SearchBox {...search} />
      <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center gap-1">
        {mode === 'tree' && onNewGroup !== undefined ? <NewGroupControl onCreate={onNewGroup} iconOnly={tight} /> : null}
        <button
          type="button"
          onClick={onNewSession}
          className={`inline-flex h-am-hit items-center gap-1.5 rounded border border-primary bg-primary-light px-3 text-sm font-medium text-primary ${FOCUS_RING}`}
        >
          <Plus aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
          New session
        </button>
        <label className="sr-only" htmlFor="agents-show">
          Sessions to show
        </label>
        <select
          id="agents-show"
          value={show}
          onChange={(event) => onShow(event.target.value === 'all' ? 'all' : 'alive')}
          className={`h-am-hit rounded border border-border bg-surface px-2 text-sm text-content ${FOCUS_RING}`}
        >
          <option value="alive">{tight ? 'Alive' : 'Alive sessions'}</option>
          <option value="all">{tight ? 'Alive + ended' : 'Alive and ended sessions'}</option>
        </select>
        <ViewOptionsControl mode={mode} options={options} onChange={onOptions} />
        <DensityControl />
        <ShortcutsHelp open={helpOpen} onOpenChange={onHelpOpenChange} />
      </div>
    </div>
  );
}
