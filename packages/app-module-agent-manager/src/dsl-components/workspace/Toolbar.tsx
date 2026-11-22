import { ButtonAction, CompactSelect, HorizontalStack } from '@wadeck-app/dsl-ui';
import { Plus } from 'lucide-react';
import { useMediaQuery } from '../ui/hooks.js';
import type { ModeId } from '../shared.js';
import type { ViewOptions } from '../logic/viewOptions.js';
import { DensityControl } from '../ui/DensityControl.js';
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
      {/* The actions sit in the library row (one gap for all of them, wrapping whole on a narrow screen); ml-auto pushes the row to the right edge. */}
      <div className="ml-auto flex min-w-0 max-w-full justify-end">
        <HorizontalStack gap="gap-2" justify="justify-end" wrap>
          {mode === 'tree' && onNewGroup !== undefined ? <NewGroupControl onCreate={onNewGroup} iconOnly={tight} /> : null}
          <ButtonAction variant="primary" icon={<Plus aria-hidden="true" className="h-3.5 w-3.5" />} label="New session" onClick={onNewSession} />
          <CompactSelect
            ariaLabel="Sessions to show"
            value={show}
            onChange={(next) => onShow(next === 'all' ? 'all' : 'alive')}
            options={[
              { value: 'alive', label: tight ? 'Alive' : 'Alive sessions' },
              { value: 'all', label: tight ? 'Alive + ended' : 'Alive and ended sessions' },
            ]}
          />
          <ViewOptionsControl mode={mode} options={options} onChange={onOptions} />
          <DensityControl />
          <ShortcutsHelp open={helpOpen} onOpenChange={onHelpOpenChange} />
        </HorizontalStack>
      </div>
    </div>
  );
}
