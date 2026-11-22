import { IconButton } from '@wadeck-app/dsl-ui';
import { Check, FolderKanban, Inbox, LayoutList, ListTree, type LucideIcon } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { MODE_LABEL, MODES, type ModeId } from '../shared.js';
import { FOCUS_RING } from '../ui/focusRing.js';
import { usePopover } from '../ui/usePopover.js';

const MODE_ICON: Record<ModeId, LucideIcon> = { tree: ListTree, groups: LayoutList, inbox: Inbox, custom: FolderKanban };

const MODE_HINT: Record<ModeId, string> = {
  tree: 'Agents under their working directory, sub-agents nested',
  groups: 'Agents by state: Needs you, Done, Working, Idle',
  inbox: 'What needs you first, in tabs',
  custom: 'Every agent inside your own groups (Herdr style), ungrouped ones last',
};

const CHECKED_ITEM = '[role="menuitemradio"][aria-checked="true"]';

/**
 * The way to list the agents behind ONE icon button (the icon of the current mode): a menu of the modes with their hint. The focus enters on the current
 * one; arrows, Home and End move it, Enter or Space picks, Escape closes with the focus back on the button. The mode is in the URL (?mode=) and remembered,
 * see logic/mode.ts. There is no shortcut per mode today, and no count: the old toggle showed none either.
 */
export function ModeMenu({ mode, onMode }: { mode: ModeId; onMode: (mode: ModeId) => void }) {
  const { open, setOpen, box, panelId } = usePopover(CHECKED_ITEM);
  const CurrentIcon = MODE_ICON[mode];

  const pick = (next: ModeId): void => {
    onMode(next);
    setOpen(false);
  };
  const onItemKeyDown = (event: KeyboardEvent<HTMLButtonElement>, id: ModeId): void => {
    const index = MODES.indexOf(id);
    const target =
      event.key === 'ArrowDown' ? MODES[(index + 1) % MODES.length] : event.key === 'ArrowUp' ? MODES[(index - 1 + MODES.length) % MODES.length] : event.key === 'Home' ? MODES[0] : event.key === 'End' ? MODES[MODES.length - 1] : undefined;
    if (target !== undefined) {
      event.preventDefault();
      box.current?.querySelector<HTMLElement>(`#agents-mode-${target}`)?.focus();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pick(id);
      return;
    }
    // Tab leaves the menu: it closes (the focus is not trapped in a popup).
    if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={box} className="relative shrink-0">
      <IconButton
        variant={open ? 'neutral' : 'ghost'}
        aria-label={`List mode: ${MODE_LABEL[mode]}`}
        title={`List mode: ${MODE_LABEL[mode]}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        icon={<CurrentIcon aria-hidden="true" className="h-4 w-4" />}
      />
      {open ? (
        <div
          id={panelId}
          role="menu"
          aria-label="List mode"
          // Narrow screens: spans the window below the button; from sm: hangs from the left edge of the button.
          className="fixed inset-x-2 z-30 mt-1 flex flex-col gap-0.5 rounded-lg border border-border bg-surface p-1 shadow-lg sm:absolute sm:inset-x-auto sm:left-0 sm:w-80 sm:max-w-[calc(100vw-1rem)]"
        >
          {MODES.map((id) => {
            const Icon = MODE_ICON[id];
            const active = id === mode;
            return (
              <button
                key={id}
                id={`agents-mode-${id}`}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                onClick={() => pick(id)}
                onKeyDown={(event) => onItemKeyDown(event, id)}
                className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted-bg ${active ? 'bg-muted-bg' : ''} ${FOCUS_RING}`}
              >
                <Icon aria-hidden="true" className="mt-0.5 h-am-icon-sm w-am-icon-sm shrink-0" />
                <span className="min-w-0 flex-1">
                  <span data-mode-name="" className={`block ${active ? 'font-medium' : ''} text-content`}>
                    {MODE_LABEL[id]}
                  </span>
                  <span data-mode-hint="" className="block text-xs text-muted-tint">
                    {MODE_HINT[id]}
                  </span>
                </span>
                {active ? <Check aria-hidden="true" className="mt-0.5 h-am-icon-sm w-am-icon-sm shrink-0 text-primary" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
