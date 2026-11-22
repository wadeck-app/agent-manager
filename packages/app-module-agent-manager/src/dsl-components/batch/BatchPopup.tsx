import { IconButton } from '@wadeck-app/dsl-ui';
import { X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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

/** Distance from the window bottom to the popup: above the dock (open or folded) when there is one, the floor otherwise. */
function measureBottom(): number {
  const frame = document.querySelector(DOCK_FRAME);
  if (frame === null) {
    return FLOOR;
  }
  const tab = frame.querySelector(DOCK_OPEN) === null ? 0 : DOCK_TAB;
  return Math.max(FLOOR, Math.round(window.innerHeight - frame.getBoundingClientRect().top + tab + DOCK_GAP));
}

/** Follows the dock: re-measured when it resizes (rows added, folded) and when the window resizes. */
function useBottom(active: boolean): number {
  const [bottom, setBottom] = useState(FLOOR);
  useLayoutEffect(() => {
    if (!active) {
      return;
    }
    const update = (): void => setBottom(measureBottom());
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

export interface BatchPopupProps {
  /** How many sessions are selected; the popup shows only above zero. */
  count: number;
  onClear: () => void;
  /** The actions, between the count and the Clear button. */
  children: ReactNode;
}

/**
 * The floating pill of the multi-selection, like the bulk bar of a table but at the bottom centre of the content area, above the A/B dock when it is there.
 * Rendered in the body (a fixed element must not depend on the list column); below the dialogs (z-50) it opens, above the page.
 */
export function BatchPopup({ count, onClear, children }: BatchPopupProps) {
  const active = count > 0;
  const bottom = useBottom(active);
  const bar = useRef<HTMLDivElement>(null);
  // The footprint is measured from the window bottom WITHOUT the dock (a dev tool that already hides the reply box when open): floor + height + gap.
  useLayoutEffect(() => {
    if (!active) {
      return;
    }
    const element = bar.current;
    const apply = (): void => document.documentElement.style.setProperty(RESERVE_VAR, `${FLOOR + Math.ceil(element?.getBoundingClientRect().height ?? 0) + DOCK_GAP}px`);
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
  }, [active]);
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
    <div data-testid="batch-popup-strip" className="pointer-events-none fixed z-40 flex justify-center px-2" style={{ left: INSET_LEFT, right: 0, bottom }}>
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
