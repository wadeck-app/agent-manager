import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

/**
 * How many of `max` droppable items must leave a one-line row for it to fit, measured on the real row (never guessed from widths): start with none dropped,
 * and while the row overflows drop one more (the layout effect re-runs before the browser paints). The count starts again when the width of the row or the
 * `signature` of its content changes. When every droppable item is gone and it still overflows, `wrap` is true: wrapping is the last resort.
 * Without ResizeObserver (a test DOM) the width is never observed, so only a change of `signature` starts again.
 */
export function useChipFit(max: number, signature: string): { ref: RefObject<HTMLDivElement | null>; dropped: number; wrap: boolean } {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [fit, setFit] = useState({ key: '', dropped: 0, wrap: false });
  const key = `${width}|${signature}|${max}`;
  const current = fit.key === key ? fit : { key, dropped: 0, wrap: false };

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    const observer = new ResizeObserver(() => setWidth(Math.round(element.clientWidth)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || current.wrap || element.scrollWidth <= element.clientWidth + 1) {
      return;
    }
    setFit(current.dropped < max ? { key, dropped: current.dropped + 1, wrap: false } : { key, dropped: current.dropped, wrap: true });
  });

  return { ref, dropped: Math.min(current.dropped, max), wrap: current.wrap };
}
