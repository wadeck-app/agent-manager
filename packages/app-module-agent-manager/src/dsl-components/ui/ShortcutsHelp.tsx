import { Keyboard } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { SHORTCUTS } from '../logic/shortcuts.js';
import { ICON_BUTTON_CLASS } from './IconButton.js';
import { Tooltip } from './Tooltip.js';

export interface ShortcutsHelpProps {
  /** Controlled by the page: the `?` key opens it. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The icon button and the small panel that lists the keyboard shortcuts. Escape or a click outside closes it; focus returns to the button. */
export function ShortcutsHelp({ open, onOpenChange }: ShortcutsHelpProps) {
  const panelId = useId();
  const box = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (!open) {
      if (wasOpen.current) {
        box.current?.querySelector<HTMLElement>('button')?.focus();
      }
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onOpenChange(false);
      }
    };
    const onPointer = (event: PointerEvent): void => {
      if (box.current !== null && event.target instanceof Node && !box.current.contains(event.target)) {
        onOpenChange(false);
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, onOpenChange]);

  return (
    <div ref={box} className="relative">
      <Tooltip content="Keyboard shortcuts">
        <button type="button" aria-label="Keyboard shortcuts" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => onOpenChange(!open)} className={`${ICON_BUTTON_CLASS} ${open ? 'bg-muted-bg text-content' : ''}`}>
          <Keyboard aria-hidden="true" className="h-am-icon-sm w-am-icon-sm" />
        </button>
      </Tooltip>
      {open ? (
        <div id={panelId} role="dialog" aria-label="Keyboard shortcuts" className="absolute right-0 top-full z-30 mt-1 w-80 rounded-lg border border-border bg-surface p-3 shadow-lg">
          <p className="mb-2 text-sm font-medium text-content">Keyboard shortcuts</p>
          <dl className="flex flex-col gap-1.5 text-sm">
            {SHORTCUTS.map((shortcut) => (
              <div key={shortcut.keys.join('+')} className="flex items-start gap-2">
                <dt className="flex w-16 shrink-0 gap-1">
                  {shortcut.keys.map((key) => (
                    <kbd key={key} className="rounded border border-border bg-muted-bg px-1.5 text-xs text-content">
                      {key}
                    </kbd>
                  ))}
                </dt>
                <dd className="text-muted">{shortcut.text}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-muted">Shortcuts are off while a text field has the focus. In the reply box: Enter sends, Shift+Enter adds a line.</p>
        </div>
      ) : null}
    </div>
  );
}
