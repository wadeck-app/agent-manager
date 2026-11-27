import { Keyboard } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { SHORTCUTS } from '../logic/shortcuts.js';
import { IconButton } from '@wadeck-app/dsl-ui';
import { POPUP_SURFACE } from './popupSurface.js';

// The panel stays inside the window: it scrolls when the list is longer than the screen (it was 932 px tall on an 800 px window).
const PANEL = 'absolute right-0 top-full z-30 mt-1 max-h-[calc(100vh-9rem)] w-96 max-w-[calc(100vw-1.5rem)] overflow-y-auto p-3';
// A fixed column wide enough for "Shift+F10"; two keys that do not fit side by side (Alt+Up, Alt+Down) wrap to a second line instead of running into the text.
const KEY_COLUMN = 'flex w-24 shrink-0 flex-wrap gap-1';
const KEYCAP = 'whitespace-nowrap rounded border border-border bg-muted-bg px-1.5 text-xs text-content';

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
      <IconButton size="icon-sm" variant={open ? 'neutral' : 'ghost'} aria-label="Keyboard shortcuts" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => onOpenChange(!open)} icon={<Keyboard aria-hidden="true" className="h-4 w-4" />} />
      {open ? (
        <div id={panelId} role="dialog" aria-label="Keyboard shortcuts" className={`${PANEL} ${POPUP_SURFACE}`}>
          <p className="mb-2 text-sm font-medium text-content">Keyboard shortcuts</p>
          <dl className="flex flex-col gap-1.5 text-sm">
            {SHORTCUTS.map((shortcut) => (
              <div key={shortcut.keys.join('+')} className="flex items-start gap-2">
                <dt className={KEY_COLUMN}>
                  {shortcut.keys.map((key) => (
                    <kbd key={key} className={KEYCAP}>
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
