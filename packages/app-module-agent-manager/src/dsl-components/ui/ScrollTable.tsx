import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

const SCROLL_CUE_START = 'pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-border to-transparent';
const SCROLL_CUE_END = 'pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-border to-transparent';

/** What the scroll region shows of its content: the edge on each side that hides columns. */
export interface ScrollCue {
  start: boolean;
  end: boolean;
}

export interface ScrollMetrics {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}

/** A rounding pixel is not hidden content: browsers report fractional widths as rounded integers. */
const SLACK_PX = 1;

/** Which sides of a horizontal scroller hide something. Pure, so the layout-free test environment can check it. */
export function scrollCue({ scrollLeft, clientWidth, scrollWidth }: ScrollMetrics): ScrollCue {
  const max = scrollWidth - clientWidth;
  if (max <= SLACK_PX) {
    return { start: false, end: false };
  }
  return { start: scrollLeft > SLACK_PX, end: scrollLeft < max - SLACK_PX };
}

/**
 * A table that scrolls sideways inside its block instead of stretching the page or squeezing its columns (a minimum width keeps every column readable), with
 * a visible cue: a fade on the side that hides columns and one sentence under the table. The scroll region is focusable and named, so the keyboard can
 * scroll it. The table stays a real `<table>` (the caller writes the head and the body).
 */
export function ScrollTable({ label, children }: { label: string; children: ReactNode }) {
  const region = useRef<HTMLDivElement>(null);
  const [cue, setCue] = useState<ScrollCue>({ start: false, end: false });
  const measure = useCallback(() => {
    const element = region.current;
    if (element === null) {
      return;
    }
    const next = scrollCue(element);
    // The same answer is not a new state: a poll that re-renders the rows every 5 s must not re-render this too.
    setCue((current) => (current.start === next.start && current.end === next.end ? current : next));
  }, []);
  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    // The columns change with the rows (a longer name widens the table) and with the pane (the shell menu is resizable).
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure);
    if (region.current !== null) {
      observer?.observe(region.current);
      if (region.current.firstElementChild !== null) {
        observer?.observe(region.current.firstElementChild);
      }
    }
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [measure]);
  const hidden = cue.start || cue.end;
  return (
    <div className="min-w-0">
      <div className="relative">
        <div ref={region} role="region" tabIndex={0} aria-label={`${label}, scrolls sideways`} onScroll={measure} className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
          <table aria-label={label} className="w-full min-w-[40rem] border-collapse">
            {children}
          </table>
        </div>
        {cue.start ? <div aria-hidden="true" data-scroll-cue="start" className={SCROLL_CUE_START} /> : null}
        {cue.end ? <div aria-hidden="true" data-scroll-cue="end" className={SCROLL_CUE_END} /> : null}
      </div>
      {hidden ? <p className="border-t border-border px-3 py-1 text-xs text-muted-tint">Scroll sideways to see all the columns.</p> : null}
    </div>
  );
}
