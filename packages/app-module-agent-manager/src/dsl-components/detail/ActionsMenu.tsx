import type { LucideIcon } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { IconButton } from '@wadeck-app/dsl-ui';
import { FOCUS_RING } from './deps.js';
import { AnchoredPopup } from './AnchoredPopup.js';

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

const ITEM = '[role="menuitem"]:not([disabled])';

/**
 * A small menu button. The menu is a floating overlay anchored to the button (AnchoredPopup: in the body, flipped, kept inside the window), never part of the
 * layout of the zone that holds the button. The first item takes the focus on open, the arrows, Home and End walk the items, Tab, Escape or a press outside
 * closes it and the focus goes back to the button.
 */
export function ActionsMenu({ label, trigger, items, split = false }: { label: string; trigger: ReactNode; items: MenuItem[]; split?: boolean }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const button = useRef<HTMLSpanElement>(null);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const entries = [...event.currentTarget.querySelectorAll<HTMLElement>(ITEM)];
    const index = entries.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : event.key === 'ArrowDown' ? index + 1 : index - 1;
    entries[(next + entries.length) % entries.length]?.focus();
  };
  return (
    <span ref={button} className="inline-flex shrink-0">
      <IconButton
        variant={split ? 'secondary' : open ? 'neutral' : 'ghost'}
        size={split ? 'icon-sm' : 'icon'}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
        icon={trigger}
      />
      {open ? (
        <AnchoredPopup anchor={button} id={panelId} role="menu" label={label} focusOnOpen={ITEM} width={224} onClose={() => setOpen(false)} onKeyDown={onKeyDown}>
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
        </AnchoredPopup>
      ) : null}
    </span>
  );
}
