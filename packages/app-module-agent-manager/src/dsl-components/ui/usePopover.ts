import { useEffect, useId, useRef, useState, type RefObject } from 'react';

export interface PopoverState {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** The wrapper of the button and the panel: a click outside it closes the popover. */
  box: RefObject<HTMLDivElement | null>;
  panelId: string;
}

/**
 * The behaviour every small popover of the toolbar shares: Escape or a click outside closes it, the focus goes into the panel when it opens (to the first
 * element matching `focusOnOpen`) and comes back to the button (`button[aria-expanded]` of the wrapper) when it closes.
 */
export function usePopover(focusOnOpen: string): PopoverState {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const box = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (!open) {
      if (wasOpen.current) {
        box.current?.querySelector<HTMLElement>('button[aria-expanded]')?.focus();
      }
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    box.current?.querySelector<HTMLElement>(focusOnOpen)?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    };
    const onPointer = (event: PointerEvent): void => {
      if (box.current !== null && event.target instanceof Node && !box.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, focusOnOpen]);

  return { open, setOpen, box, panelId };
}
