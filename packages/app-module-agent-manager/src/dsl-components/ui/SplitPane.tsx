import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { FOCUS_RING } from './IconButton.js';

export const MIN_LIST_WIDTH = 240;
export const MAX_LIST_WIDTH = 560;
export const DEFAULT_LIST_WIDTH = 320;
const STEP = 16;
const STORAGE_KEY = 'agent-manager.listWidth';

export function clampWidth(width: number, min = MIN_LIST_WIDTH, max = MAX_LIST_WIDTH): number {
  return Math.min(max, Math.max(min, Math.round(width)));
}

/** The width saved by the user, or the default when nothing valid is saved. A storage that throws (private mode) means "nothing saved". */
export function readSavedWidth(): number {
  try {
    const saved = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(saved) && saved > 0 ? clampWidth(saved) : DEFAULT_LIST_WIDTH;
  } catch {
    return DEFAULT_LIST_WIDTH;
  }
}

function saveWidth(width: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // Not saved: the width simply resets on reload. Nothing the user could fix, nothing worth an error banner.
  }
}

export interface SplitPaneProps {
  list: ReactNode;
  detail: ReactNode;
  /** A session is open: on a narrow screen the detail replaces the list (stacked, with a back button in the detail header). */
  detailOpen: boolean;
  /** A fixed width in pixels (the icon rail): no separator, no resizing. */
  fixedWidth?: number;
}

/**
 * Left column + detail pane. Resizable: drag the separator or focus it and press the arrow keys (Home and End for the limits); the width is kept in
 * localStorage. Below the lg breakpoint (1024 px: the shell sidebar takes 240 px of it) only one pane is shown at a time (the list, or the detail once a session is open).
 */
export function SplitPane({ list, detail, detailOpen, fixedWidth }: SplitPaneProps) {
  const [width, setWidth] = useState<number>(() => (fixedWidth ?? readSavedWidth()));
  const drag = useRef<{ startX: number; startWidth: number } | undefined>(undefined);
  const effective = fixedWidth ?? width;

  useEffect(() => {
    if (fixedWidth === undefined) {
      saveWidth(width);
    }
  }, [width, fixedWidth]);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { startX: event.clientX, startWidth: width };
    },
    [width],
  );
  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (drag.current !== undefined) {
      setWidth(clampWidth(drag.current.startWidth + event.clientX - drag.current.startX));
    }
  }, []);
  const onPointerUp = useCallback(() => {
    drag.current = undefined;
  }, []);
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const next = event.key === 'ArrowLeft' ? (value: number) => value - STEP : event.key === 'ArrowRight' ? (value: number) => value + STEP : event.key === 'Home' ? () => MIN_LIST_WIDTH : event.key === 'End' ? () => MAX_LIST_WIDTH : undefined;
    if (next !== undefined) {
      event.preventDefault();
      setWidth((value) => clampWidth(next(value)));
    }
  }, []);

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden rounded-lg border border-border bg-surface" style={{ '--agents-list-w': `${effective}px` } as React.CSSProperties}>
      <div data-pane="list" className={`${detailOpen ? 'hidden lg:flex' : 'flex'} relative min-h-0 w-full shrink-0 flex-col lg:w-[var(--agents-list-w)]`}>
        {list}
      </div>
      {fixedWidth === undefined ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the agent list"
          aria-valuemin={MIN_LIST_WIDTH}
          aria-valuemax={MAX_LIST_WIDTH}
          aria-valuenow={width}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={onKeyDown}
          className={`hidden w-1 shrink-0 cursor-col-resize bg-border hover:bg-primary lg:block ${FOCUS_RING}`}
        />
      ) : (
        <div aria-hidden="true" className="hidden w-px shrink-0 bg-border lg:block" />
      )}
      <div data-pane="detail" className={`${detailOpen ? 'flex' : 'hidden lg:flex'} min-h-0 min-w-0 flex-1 flex-col`}>
        {detail}
      </div>
    </div>
  );
}
