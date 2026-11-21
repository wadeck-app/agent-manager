import type { LucideIcon } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { FOCUS_RING, ICON_BUTTON_CLASS, Tooltip, usePopover } from './deps.js';

export interface MenuItem {
  id: string;
  icon: LucideIcon;
  label: string;
  /** The item is shown but cannot be used now. */
  disabled: boolean;
  /** Why it is not available (shown under the label). */
  reason?: string;
  run: () => void;
}

/** A small menu button: the first item takes the focus on open, the arrows walk the items, Escape or a click outside closes it and gives the focus back. */
export function ActionsMenu({ label, trigger, items, split = false }: { label: string; trigger: ReactNode; items: MenuItem[]; split?: boolean }) {
  const { open, setOpen, box, panelId } = usePopover('[role="menuitem"]:not([disabled])');
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
      return;
    }
    event.preventDefault();
    const entries = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')];
    const index = entries.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
    entries[(next + entries.length) % entries.length]?.focus();
  };
  return (
    <div ref={box} className="relative shrink-0">
      <Tooltip content={label}>
        <button
          type="button"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen(!open)}
          className={split ? `inline-flex h-am-hit w-am-hit items-center justify-center rounded-r border border-l-0 border-border text-muted hover:bg-muted-bg hover:text-content ${FOCUS_RING}` : `${ICON_BUTTON_CLASS} ${open ? 'bg-muted-bg text-content' : ''}`}
        >
          {trigger}
        </button>
      </Tooltip>
      {open ? (
        <div id={panelId} role="menu" aria-label={label} onKeyDown={onKeyDown} className="absolute right-0 top-full z-30 mt-1 flex min-w-48 flex-col rounded-lg border border-border bg-surface p-1 shadow-lg">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.run();
              }}
              className={`flex min-h-am-hit w-full items-center gap-2 rounded px-2.5 text-left text-sm text-content hover:bg-muted-bg disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
            >
              <item.icon aria-hidden="true" className="h-am-icon-sm w-am-icon-sm shrink-0 text-muted" />
              <span className="flex min-w-0 flex-col">
                <span>{item.label}</span>
                {item.disabled && item.reason !== undefined ? <span className="text-xs text-muted">{item.reason}</span> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
