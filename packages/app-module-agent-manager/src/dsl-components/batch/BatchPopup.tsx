import { IconButton } from '@wadeck-app/dsl-ui';
import { X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { selectedText } from '../logic/selection.js';
import { Scope } from '../ui/Scope.js';

/** Space kept between the popup and the A/B dock under it. */
export const DOCK_GAP = 8;
/** The fold tab sits on the top edge of the open dock (AbDock: `-top-3`), so the popup clears it too. */
export const DOCK_TAB = 12;
/** Distance from the window bottom with no dock: the dock's own `bottom-6`. */
const FLOOR = 24;
/** The page lifts its bottom row (the reply box) by this much while the popup is shown: `Workspace` pads its bottom with it. */
export const RESERVE_VAR = '--batch-popup-reserve';
/** Left edge of the content area: the same inset the A/B dock uses, so the popup is never centred under the side menu. */
const INSET_LEFT = 'var(--ab-dock-inset-left, var(--app-shell-menu-width, 0px))';
/** AbDock publishes no height or variable: its frame is found by this test id (dsl-ui `AbDock`); it is absent outside the dev server, which is normal. */
const DOCK_FRAME = '[data-testid="ab-dock-frame"]';
const DOCK_OPEN = '[data-testid="ab-dock"]:not([hidden])';

/** Distance from the window bottom to the popup (above the dock, open or folded, when there is one, the floor otherwise), and whether the dock is folded. */
function measureBottom(): { bottom: number; folded: boolean } {
  const frame = document.querySelector(DOCK_FRAME);
  if (frame === null) {
    return { bottom: FLOOR, folded: false };
  }
  const folded = frame.querySelector(DOCK_OPEN) === null;
  const tab = folded ? 0 : DOCK_TAB;
  return { bottom: Math.max(FLOOR, Math.round(window.innerHeight - frame.getBoundingClientRect().top + tab + DOCK_GAP)), folded };
}

/** Follows the dock: re-measured when it resizes (rows added, folded) and when the window resizes. */
function useBottom(active: boolean): { bottom: number; folded: boolean } {
  const [bottom, setBottom] = useState({ bottom: FLOOR, folded: false });
  useLayoutEffect(() => {
    if (!active) {
      return;
    }
    const update = (): void => {
      const next = measureBottom();
      setBottom((previous) => (previous.bottom === next.bottom && previous.folded === next.folded ? previous : next));
    };
    update();
    window.addEventListener('resize', update);
    const frame = document.querySelector(DOCK_FRAME);
    // Where there is no ResizeObserver (very old engines) the window resize is the only trigger.
    const observer = frame !== null && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : undefined;
    if (frame !== null) {
      observer?.observe(frame);
    }
    return () => {
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, [active]);
  return bottom;
}
/** The list column of the page: the popup must not cover it when there is room to the right of it. */
const LIST_PANE = '[data-pane="list"]';
/** Room kept on both sides of the pill (the strip's own `px-2`). */
const SIDE_ROOM = 16;

/**
 * Where the strip starts, in px, so that the pill clears the list column: the right edge of the list when the pill (its measured width) fits between that
 * edge and the window edge, else 0 (the whole content area: a narrow window or a list that fills it, nothing better exists).
 */
export function clearListLeft(listRight: number | undefined, barWidth: number, windowWidth: number): number {
  if (listRight === undefined || barWidth <= 0 || windowWidth - listRight < barWidth + SIDE_ROOM) {
    return 0;
  }
  return Math.round(listRight);
}

/** Follows the list column and the pill: re-measured when either resizes and when the window resizes. */
function useClearList(active: boolean, bar: RefObject<HTMLDivElement | null>): number {
  const [left, setLeft] = useState(0);
  useLayoutEffect(() => {
    if (!active) {
      return;
    }
    const update = (): void => {
      const pane = document.querySelector(LIST_PANE);
      const next = clearListLeft(pane?.getBoundingClientRect().right, bar.current?.getBoundingClientRect().width ?? 0, window.innerWidth);
      setLeft((previous) => (previous === next ? previous : next));
    };
    update();
    window.addEventListener('resize', update);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update);
    const pane = document.querySelector(LIST_PANE);
    if (pane !== null) {
      observer?.observe(pane);
    }
    if (bar.current !== null) {
      observer?.observe(bar.current);
    }
    return () => {
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, [active, bar]);
  return left;
}


export interface BatchPopupProps {
  /** How many sessions are selected; the popup shows only above zero. */
  count: number;
  onClear: () => void;
  /** The actions, between the count and the Clear button. */
  children: ReactNode;
}

/**
 * The floating pill of the multi-selection, like the bulk bar of a table but at the bottom centre of the content area, above the A/B dock when it is there.
 * Starts at the right edge of the list column when the pill fits to the right of it, so it never covers the list. Rendered in the body (a fixed element must not depend on the list column); below the dialogs (z-50) it opens, above the page.
 */
export function BatchPopup({ count, onClear, children }: BatchPopupProps) {
  const active = count > 0;
  const { bottom, folded } = useBottom(active);
  // Room below the popup that the page must clear: the floor, or (folded dock, a pill that does not hide the reply box) the folded dock height as well.
  const below = folded ? bottom : FLOOR;
  const bar = useRef<HTMLDivElement>(null);
  const clearLeft = useClearList(active, bar);
  // The footprint is measured from the window bottom: an open dock is ignored (it already hides the reply box), a folded one counts: below + height + gap.
  useLayoutEffect(() => {
    if (!active) {
      return;
    }
    const element = bar.current;
    const apply = (): void => document.documentElement.style.setProperty(RESERVE_VAR, `${below + Math.ceil(element?.getBoundingClientRect().height ?? 0) + DOCK_GAP}px`);
    apply();
    // The actions wrap on a narrow window: the room follows the height.
    const observer = element !== null && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(apply) : undefined;
    if (element !== null) {
      observer?.observe(element);
    }
    return () => {
      observer?.disconnect();
      document.documentElement.style.removeProperty(RESERVE_VAR);
    };
  }, [active, below]);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = window.setTimeout(() => setShown(true), 16);
    return () => window.clearTimeout(timer);
  }, [active]);
  if (!active) {
    return null;
  }
  return createPortal(
    <Scope>
    <div data-testid="batch-popup-strip" className="pointer-events-none fixed z-40 flex justify-center px-2" style={{ left: clearLeft === 0 ? INSET_LEFT : `max(${INSET_LEFT}, ${clearLeft}px)`, right: 0, bottom }}>
      <div
        ref={bar}
        data-batch-bar=""
        role="toolbar"
        aria-label="Actions on the selected sessions"
        className={`pointer-events-auto flex max-w-full flex-wrap items-center gap-1.5 rounded-2xl border border-border bg-surface px-3 py-1.5 shadow-2xl transition-all duration-200 ease-out ${shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'}`}
      >
        <span role="status" aria-live="polite" className="mr-1 text-sm font-medium text-content">
          {selectedText(count)}
        </span>
        {children}
        <span className="ml-auto">
          <IconButton size="icon-sm" aria-label="Clear the selection (Escape)" onClick={onClear} icon={<X aria-hidden="true" className="h-4 w-4" />} />
        </span>
      </div>
    </div>
    </Scope>,
    document.body,
  );
}
