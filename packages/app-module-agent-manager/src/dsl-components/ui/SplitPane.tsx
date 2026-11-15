import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { FOCUS_RING } from './IconButton.js';

export const MIN_LIST_WIDTH = 240;
/** The most the user can give the list, and the most the automatic width reaches (on a wide screen the log needs the room more). */
export const MAX_LIST_WIDTH = 640;
/** The automatic width never goes under this (a row has to show a folder, a name and a time) nor over MAX_LIST_WIDTH. */
export const DEFAULT_LIST_WIDTH = 300;
/** Share of the workspace the list takes until the user drags the separator: 22 % (about 300 px at 1440 px of screen, 510 px at 2560 px). */
export const AUTO_LIST_SHARE = 0.22;
/** The detail pane keeps at least this share of the workspace, whatever the user asks for. */
const MAX_LIST_SHARE = 0.45;
const STEP = 16;
// A new key: the first version saved its default width on every load, so an old value would pin every user to 320 px.
const STORAGE_KEY = 'agent-manager.listWidth.v2';

/** Keeps a width inside the limits: the absolute ones, and no more than MAX_LIST_SHARE of the workspace when that is known (`container` above 0). */
export function clampWidth(width: number, container = 0): number {
  const max = container > 0 ? Math.max(MIN_LIST_WIDTH, Math.min(MAX_LIST_WIDTH, Math.floor(container * MAX_LIST_SHARE))) : MAX_LIST_WIDTH;
  return Math.min(max, Math.max(MIN_LIST_WIDTH, Math.round(width)));
}

/** The width of the list while the user has not chosen one: a share of the workspace, so it grows with the screen. */
export function autoListWidth(container: number): number {
  return Math.min(MAX_LIST_WIDTH, Math.max(DEFAULT_LIST_WIDTH, Math.round(container * AUTO_LIST_SHARE)));
}

/** The width chosen by the user, or undefined when nothing valid is saved. A storage that throws (private mode) means "nothing saved". */
export function readSavedWidth(): number | undefined {
  try {
    const saved = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(saved) && saved > 0 ? clampWidth(saved) : undefined;
  } catch {
    return undefined;
  }
}

function saveWidth(width: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(width));
  } catch {
    // Not saved: the width resets on reload. Nothing the user could fix, nothing worth an error banner.
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
 * Left column + detail pane. The list takes AUTO_LIST_SHARE of the workspace (so it grows with the screen) until the user drags the separator or focuses it and
 * presses the arrow keys (Home and End for the limits): that width is then kept in localStorage. Below the lg breakpoint (1024 px: the shell menu takes
 * 240 px of it) only one pane is shown at a time (the list, or the detail once a session is open).
 */
export function SplitPane({ list, detail, detailOpen, fixedWidth }: SplitPaneProps) {
  const box = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState(0);
  // The width the user chose, as saved. Only a drag or a key step writes it: showing a clamped width (a small window) never rewrites it, so the choice comes
  // back when the window grows again.
  const [chosen, setChosen] = useState<number | undefined>(readSavedWidth);
  // The width during a drag: shown at once, saved once when the pointer is released (not on every move).
  const [live, setLive] = useState<number | undefined>(undefined);
  const drag = useRef<{ startX: number; startWidth: number; lastWidth: number } | undefined>(undefined);
  // The pointer and key handlers read the current container and width from refs: a handler created in an earlier render would clamp against a stale size.
  const containerRef = useRef(0);

  // A layout effect: the measure and the re-render it causes both happen before the browser paints, so the first paint already has the clamped width.
  useLayoutEffect(() => {
    const element = box.current;
    if (element === null) {
      return;
    }
    const measure = (): void => {
      containerRef.current = element.clientWidth;
      setContainer(element.clientWidth);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);

  const shown = fixedWidth ?? live ?? (chosen === undefined ? autoListWidth(container) : clampWidth(chosen, container));
  const widthRef = useRef(shown);
  widthRef.current = shown;

  const choose = useCallback((next: number) => {
    setChosen(next);
    saveWidth(next);
  }, []);

  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: widthRef.current, lastWidth: widthRef.current };
  }, []);
  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (current !== undefined) {
      current.lastWidth = clampWidth(current.startWidth + event.clientX - current.startX, containerRef.current);
      setLive(current.lastWidth);
    }
  }, []);
  const endDrag = useCallback(() => {
    const current = drag.current;
    drag.current = undefined;
    if (current !== undefined && current.lastWidth !== current.startWidth) {
      choose(current.lastWidth);
    }
    setLive(undefined);
  }, [choose]);
  // A step starts from the width that is SHOWN (on a narrow window that is the clamped one), then saves the new width: the first key press is the user's choice.
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const current = widthRef.current;
      const next = event.key === 'ArrowLeft' ? current - STEP : event.key === 'ArrowRight' ? current + STEP : event.key === 'Home' ? MIN_LIST_WIDTH : event.key === 'End' ? MAX_LIST_WIDTH : undefined;
      if (next !== undefined) {
        event.preventDefault();
        choose(clampWidth(next, containerRef.current));
      }
    },
    [choose],
  );
  const width = shown;

  return (
    <div ref={box} className="flex h-full min-h-0 w-full overflow-hidden" style={{ '--agents-list-w': `${width}px` } as React.CSSProperties}>
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
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onKeyDown={onKeyDown}
          className={`hidden w-1.5 shrink-0 cursor-col-resize border-x border-border bg-muted-bg hover:bg-primary lg:block ${FOCUS_RING}`}
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
