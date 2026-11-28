import { CompactSelect, HeaderActions, HorizontalStack, Tooltip } from '@wadeck-app/dsl-ui';
import type { ReactNode } from 'react';
import { SelectionEntry } from '../batch/SelectionEntry.js';
import { useMediaQuery } from '../ui/hooks.js';
import { SHOW_ALIVE_LABEL, SHOW_ALL_LABEL, type ModeId } from '../shared.js';
import type { ViewOptions } from '../logic/viewOptions.js';
import { DensityControl } from '../ui/DensityControl.js';
import { ShortcutsHelp } from '../ui/ShortcutsHelp.js';
import { Scope } from '../ui/Scope.js';
import { TrailRow } from './TrailRow.js';
import { ListLayoutMenu } from './ListLayoutMenu.js';
import { MoreMenu } from './MoreMenu.js';
import { SearchBox, type SearchBoxProps } from './SearchBox.js';

const TITLE = 'text-base font-semibold leading-none text-content';
const TRAIL_ROW = 'min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1';
// Narrow screen: one tight row of icon buttons (4 px apart), it wraps whole controls into a second row only as a last resort.
const TRAIL_ROW_COMPACT = 'min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-1';

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
  /** A session is open: below the lg breakpoint the detail replaces the list, so the toolbar (which acts on the list) gives its room back to the detail. */
  detailOpen?: boolean;
  /** The ids the list shows (what the select-all box ticks); absent: no box. */
  selectableIds?: readonly string[];
  /** The notices button (a NoticesButton, which renders nothing without an active notice): first of the right-aligned controls. */
  notices?: ReactNode;
}

/**
 * The one slim line at the top of the workspace (inside its box, not above it): what the page is, the selection mode toggle (with the Select all slot), the list layout and view options (ONE fixed icon, one popup), the
 * search, then the notices, which sessions to show and the icon buttons that are not list options (text size, shortcut help). New session and New group are
 * not here: they are the action bar of the list pane (ListFooter), always visible under the list.
 */
export function Toolbar({ count, hiddenDead, show, onShow, mode, onMode, options, onOptions, search, helpOpen, onHelpOpenChange, detailOpen = false, selectableIds, notices = null }: ToolbarProps) {
  // Under 1280 px (the shell menu takes 240 px of it) the toolbar keeps one row: a number for the count, short labels.
  const countText = `${count} ${count === 1 ? 'session' : 'sessions'}${show === 'alive' && hiddenDead > 0 ? `, ${hiddenDead} ended hidden` : ''}`;
  const tight = useMediaQuery('(max-width: 1279px)');
  // Under 640 px the trail slot is about 190 px wide: the title (the crumb already says it) is for screen readers only, the search folds to an icon and the count, the sessions filter, the text size and the shortcuts move into ONE overflow menu (MoreMenu): the toolbar is one row of icon buttons.
  const compact = useMediaQuery('(max-width: 639px)');
  // The Select all button of the selection mode has a reserved slot next to the toggle (SelectionEntry): turning the mode on moves nothing in the toolbar.
  const shortCount = tight;
  const compactContent = (
    <>
      <h1 className="sr-only">Agents</h1>
      {selectableIds === undefined ? null : <SelectionEntry ids={selectableIds} reserveSlot={false} />}
      <ListLayoutMenu mode={mode} onMode={onMode} options={options} onOptions={onOptions} />
      <SearchBox {...search} compact />
      {/* Empty (and so hidden) while no notice is active: no extra gap in the row. */}
      <div data-notices-slot="" className="empty:hidden">
        {notices}
      </div>
      <MoreMenu countText={countText} show={show} onShow={onShow} helpOpen={helpOpen} onHelpOpenChange={onHelpOpenChange} />
    </>
  );
  const content = (
    <>
      <h1 className={TITLE}>Agents</h1>
      {selectableIds === undefined ? null : <SelectionEntry ids={selectableIds} />}
      <Tooltip content={shortCount ? countText : undefined} describe={false}>
        <span className="text-sm text-muted">
          {shortCount ? (
            <>
              <span aria-hidden="true">{count}</span>
              <span className="sr-only">{countText}</span>
            </>
          ) : (
            countText
          )}
        </span>
      </Tooltip>
      <ListLayoutMenu mode={mode} onMode={onMode} options={options} onOptions={onOptions} />
      <SearchBox {...search} />
      {/* The actions sit in the library row (one gap for all of them, wrapping whole on a narrow screen); ml-auto pushes the row to the right edge. */}
      <div className="ml-auto flex min-w-0 max-w-full justify-end">
        <HorizontalStack gap="gap-2" justify="justify-end" wrap>
          {/* Empty (and so hidden) while no notice is active: no extra gap in the row. */}
          <div data-notices-slot="" className="empty:hidden">
            {notices}
          </div>
          <CompactSelect
            ariaLabel="Sessions to show"
            size="sm"
            value={show}
            onChange={(next) => onShow(next === 'all' ? 'all' : 'alive')}
            options={[
              { value: 'alive', label: tight ? 'Alive' : SHOW_ALIVE_LABEL },
              { value: 'all', label: tight ? 'Alive + ended' : SHOW_ALL_LABEL },
            ]}
          />
          <DensityControl />
          <ShortcutsHelp open={helpOpen} onOpenChange={onHelpOpenChange} />
        </HorizontalStack>
      </div>
    </>
  );
  const visibility = detailOpen ? 'hidden lg:flex' : 'flex';
  // In the shell trail row (HeaderActions portals it there, outside our page root: Scope brings back the stylesheet scope and the density variables). A flex row of unknown width: it takes the room that is left (flex-1, min-w-0), wraps whole controls, no border or padding of its own.
  return (
    <HeaderActions>
      <Scope>
        <TrailRow className={`${visibility} ${compact ? TRAIL_ROW_COMPACT : TRAIL_ROW}`}>{compact ? compactContent : content}</TrailRow>
      </Scope>
    </HeaderActions>
  );
}
