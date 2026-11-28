import { CompactSelect, IconButton } from '@wadeck-app/dsl-ui';
import { Ellipsis, Keyboard } from 'lucide-react';
import { DensityChoices } from '../ui/DensityChoices.js';
import { FOCUS_RING } from '../ui/focusRing.js';
import { POPUP_SECTION, POPUP_SURFACE } from '../ui/popupSurface.js';
import { RowButton } from '../ui/RowButton.js';
import { ShortcutsHelp } from '../ui/ShortcutsHelp.js';
import { usePopover } from '../ui/usePopover.js';

const PANEL = `fixed inset-x-2 z-30 mt-1 flex max-h-[calc(100vh-12rem)] flex-col gap-2 overflow-y-auto ${POPUP_SURFACE} p-2`;
const SECTION_TITLE = 'px-1 text-xs font-semibold text-muted';
const SHORTCUTS_ROW = `flex min-h-am-hit w-full items-center gap-2 rounded px-3 py-1 text-left text-sm text-content hover:bg-muted-bg ${FOCUS_RING}`;

export interface MoreMenuProps {
  /** The sentence about the sessions in the list ("22 sessions, 3 ended hidden"): the count has no room in the toolbar of a narrow screen. */
  countText: string;
  show: 'alive' | 'all';
  onShow: (show: 'alive' | 'all') => void;
  helpOpen: boolean;
  onHelpOpenChange: (open: boolean) => void;
}

/**
 * The overflow menu of the toolbar on a narrow screen (under 640 px, where the trail slot is about 190 px wide): one icon button that holds what has no room as a
 * button of its own: the number of sessions, which sessions to show, the text size and the keyboard shortcuts. The shortcut panel stays rendered next to the button
 * (it is also opened by the ? key) and the menu closes when it opens. Escape or a click outside closes the menu and the focus goes back to its button.
 */
export function MoreMenu({ countText, show, onShow, helpOpen, onHelpOpenChange }: MoreMenuProps) {
  const { open, setOpen, box, panelId } = usePopover('select');
  return (
    <div ref={box} className="relative shrink-0">
      <IconButton
        size="icon-sm"
        variant={open ? 'neutral' : 'ghost'}
        aria-label="More options"
        tooltip={countText}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
        icon={<Ellipsis aria-hidden="true" className="h-4 w-4" />}
      />
      <ShortcutsHelp open={helpOpen} onOpenChange={onHelpOpenChange} hideButton />
      {open ? (
        <div id={panelId} role="dialog" aria-label="More options" className={PANEL}>
          <p role="status" className="px-1 text-sm text-muted">
            {countText}
          </p>
          <CompactSelect
            ariaLabel="Sessions to show"
            size="sm"
            value={show}
            onChange={(next) => onShow(next === 'all' ? 'all' : 'alive')}
            options={[
              { value: 'alive', label: 'Alive' },
              { value: 'all', label: 'Alive + ended' },
            ]}
          />
          <div className={`flex flex-col gap-1 ${POPUP_SECTION} pt-1`}>
            <p className={SECTION_TITLE}>Text size</p>
            <DensityChoices />
          </div>
          <div className={POPUP_SECTION}>
            <RowButton
              type="button"
              onClick={() => {
                setOpen(false);
                onHelpOpenChange(true);
              }}
              className={SHORTCUTS_ROW}
            >
              <Keyboard aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0" />
              Keyboard shortcuts
            </RowButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
