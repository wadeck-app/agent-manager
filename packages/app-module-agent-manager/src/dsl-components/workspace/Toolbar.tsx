import { DensityControl } from '../ui/DensityControl.js';
import { FOCUS_RING } from '../ui/IconButton.js';
import { ShortcutsHelp } from '../ui/ShortcutsHelp.js';

export interface ToolbarProps {
  /** Sessions in the list. */
  count: number;
  /** Dead sessions the filter hides (from the page answer); 0 when none or when they are shown. */
  hiddenDead: number;
  show: 'alive' | 'all';
  onShow: (show: 'alive' | 'all') => void;
  helpOpen: boolean;
  onHelpOpenChange: (open: boolean) => void;
}

/** The one slim line at the top of the workspace (inside its box, not above it): what the page is, how many sessions, which sessions to show, the text size and the shortcut help. */
export function Toolbar({ count, hiddenDead, show, onShow, helpOpen, onHelpOpenChange }: ToolbarProps) {
  return (
    <div className="flex min-h-am-hit flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-3 py-1">
      <h1 className="text-base font-semibold leading-none text-content">Agents</h1>
      <span className="text-sm text-muted">
        {count} {count === 1 ? 'session' : 'sessions'}
        {show === 'alive' && hiddenDead > 0 ? `, ${hiddenDead} ended hidden` : ''}
      </span>
      <div className="ml-auto flex items-center gap-1">
        <label className="sr-only" htmlFor="agents-show">
          Sessions to show
        </label>
        <select
          id="agents-show"
          value={show}
          onChange={(event) => onShow(event.target.value === 'all' ? 'all' : 'alive')}
          className={`h-am-hit rounded border border-border bg-surface px-2 text-sm text-content ${FOCUS_RING}`}
        >
          <option value="alive">Alive sessions</option>
          <option value="all">Alive and ended sessions</option>
        </select>
        <DensityControl />
        <ShortcutsHelp open={helpOpen} onOpenChange={onHelpOpenChange} />
      </div>
    </div>
  );
}
