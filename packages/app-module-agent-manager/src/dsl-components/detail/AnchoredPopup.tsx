import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Scope } from '../ui/Scope.js';

/** The room kept between the popup and the edges of the window, and the gap between the popup and its button. */
const MARGIN = 8;
const GAP = 4;

export interface Placement {
  left: number;
  top: number;
  /** The room the popup has on its side of the button: it scrolls inside when its content is taller. */
  maxHeight: number;
}

/**
 * Where a popup of `width` x `height` goes for a button at `anchor`, in a window of `view`: under the button with its right edge on the button's right
 * edge, flipped above the button when it does not fit below and there is more room above, always kept inside the window.
 */
export function placePopup(anchor: { left: number; right: number; top: number; bottom: number }, size: { width: number; height: number }, view: { width: number; height: number }): Placement {
  const below = view.height - anchor.bottom - GAP - MARGIN;
  const above = anchor.top - GAP - MARGIN;
  const flip = size.height > below && above > below;
  const room = Math.max(flip ? above : below, 0);
  const height = Math.min(size.height, room);
  const left = Math.max(MARGIN, Math.min(anchor.right - size.width, view.width - size.width - MARGIN));
  const top = flip ? anchor.top - GAP - height : anchor.bottom + GAP;
  return { left, top, maxHeight: room };
}

export interface AnchoredPopupProps {
  /** The element that holds the button the popup hangs from: it stays outside the popup for the click-outside test (the button toggles by itself) and gets the focus back. */
  anchor: RefObject<HTMLElement | null>;
  id: string;
  role: 'menu' | 'dialog';
  label: string;
  onClose: () => void;
  /** The first element matching it takes the focus when the popup opens. */
  focusOnOpen: string;
  width?: number;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}

/**
 * A floating overlay anchored to its button: drawn in the body (position fixed), so it never takes room in the layout of the zone it is opened from and no
 * scrolling or clipping ancestor cuts it; flipped above the button and kept inside the window (placePopup), re-placed when the window resizes or anything
 * scrolls. Escape or a press outside closes it, the focus goes into it when it opens and back to the button when it closes.
 */
export function AnchoredPopup({ anchor, id, role, label, onClose, focusOnOpen, width = 256, onKeyDown, children }: AnchoredPopupProps) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [place, setPlace] = useState<Placement | undefined>(undefined);

  useLayoutEffect(() => {
    const update = (): void => {
      const button = anchor.current?.getBoundingClientRect();
      const panel = box.current;
      if (button === undefined || panel === null) {
        return;
      }
      // The natural height of the content, measured without the height cap of the previous placement.
      const natural = panel.scrollHeight + (panel.offsetHeight - panel.clientHeight);
      setPlace(placePopup(button, { width: panel.offsetWidth, height: natural }, { width: window.innerWidth, height: window.innerHeight }));
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchor]);

  useEffect(() => {
    (box.current?.querySelector<HTMLElement>(focusOnOpen) ?? box.current)?.focus();
    const button = anchor.current;
    const panel = box.current;
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }
    };
    const onPointer = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Node && box.current !== null && !box.current.contains(target) && button?.contains(target) !== true) {
        close.current();
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
      // Closed with the focus lost with the popup (Escape, a choice): the button gets it back. A click on another control keeps its own focus.
      const active = document.activeElement;
      if ((active === null || active === document.body || panel?.contains(active) === true) && button?.isConnected === true) {
        // The anchor is the wrapper of the button: the focus goes to the button it holds.
        (button.querySelector<HTMLElement>('button') ?? button).focus();
      }
    };
  }, [anchor, focusOnOpen]);

  return createPortal(
    <Scope>
      <div
        ref={box}
        id={id}
        role={role}
        aria-label={label}
        data-anchored-popup=""
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={{ position: 'fixed', left: place?.left ?? 0, top: place?.top ?? 0, width: `min(${width}px, calc(100vw - ${2 * MARGIN}px))`, maxHeight: place?.maxHeight, visibility: place === undefined ? 'hidden' : 'visible' }}
        className="z-50 flex flex-col overflow-y-auto rounded-lg border focus:outline-none border-border bg-surface p-1 text-sm shadow-lg"
      >
        {children}
      </div>
    </Scope>,
    document.body,
  );
}
